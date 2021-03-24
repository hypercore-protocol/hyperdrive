const pathRoot = require('path')
const path = pathRoot.posix || pathRoot
const { EventEmitter } = require('events')

const collect = require('stream-collector')
const thunky = require('thunky')
const ThunkyMap = require('thunky-map')
const unixify = require('unixify')
const duplexify = require('duplexify')
const pump = require('pump')
const pumpify = require('pumpify')
const { Transform } = require('streamx')

const coreByteStream = require('hypercore-byte-stream')
const Nanoresource = require('nanoresource/emitter')
const HypercoreProtocol = require('hypercore-protocol')
const MountableHypertrie = require('mountable-hypertrie')
const Corestore = require('corestore')
const { Stat } = require('hyperdrive-schemas')

const createFileDescriptor = require('./lib/fd')
const errors = require('./lib/errors')
const defaultCorestore = require('./lib/storage')
const TagManager = require('./lib/tagging')
const HyperdrivePromises = require('./promises')
const { contentKeyPair, contentOptions, ContentState } = require('./lib/content')
const { statIterator, createStatStream, createMountStream, createReaddirStream, readdirIterator } = require('./lib/iterator')

// 20 is arbitrary, just to make the fds > stdio etc
const STDIO_CAP = 20
const WRITE_STREAM_BLOCK_SIZE = 524288
const NOOP_FILE_PATH = ' '

module.exports = HyperdriveCompat
module.exports.constants = require('filesystem-constants').linux

class Hyperdrive extends Nanoresource {
  constructor (storage, key, opts) {
    super()
    this._initialize(storage, key, opts)
  }

  _initialize (storage, key, opts) {
    if (isObject(key)) {
      opts = key
      key = null
    }
    if (!opts) opts = {}

    this.opts = opts
    this.key = key
    this.discoveryKey = null
    this.live = true
    this.sparse = opts.sparse !== false
    this.sparseMetadata = opts.sparseMetadata !== false
    this.subtype = opts.subtype || 'hyperdrive'

    this.promises = new HyperdrivePromises(this)

    this._namespace = opts.namespace
    this.corestore = defaultCorestore(storage, {
      ...opts,
      valueEncoding: 'binary',
      // TODO: Support mixed sparsity.
      sparse: this.sparse || this.sparseMetadata,
      extensions: opts.extensions
    })

    if (this.corestore !== storage) this.corestore.on('error', err => this.emit('error', err))
    if (opts.namespace) {
      this.corestore = this.corestore.namespace(opts.namespace)
    }

    // Set in ready.
    this.metadata = null
    this.db = opts._db
    this.tags = new TagManager(this)
    this.isCheckout = !!this.db

    this._contentStates = opts._contentStates || new ThunkyMap(this._contentStateFromMetadata.bind(this))
    this._fds = []
    this._writingFds = new Map()
    this._unlistens = []
    this._unmirror = null

    this._metadataOpts = {
      key,
      sparse: this.sparseMetadata,
      keyPair: opts.keyPair,
      extensions: opts.extensions
    }

    this.ready(onReady)

    const self = this

    function onReady (err) {
      if (err) return self.emit('error', err)
      self.emit('ready')

      if (self._contentStates.has(self.db.feed)) return
      self._getContent(self.db.feed, noop)
    }
  }

  get version () {
    // TODO: The trie version starts at 1, so the empty hyperdrive version is also 1. This should be 0.
    return this.db.version
  }

  get writable () {
    return this.metadata.writable
  }

  get contentWritable () {
    const contentState = this._contentStates.cache.get(this.db.feed)
    if (!contentState) return false
    return contentState.feed.writable
  }

  ready (cb) {
    return this.open(cb)
  }

  _open (cb) {
    const self = this
    return this.corestore.ready(err => {
      if (err) return cb(err)
      this.metadata = this.corestore.default(this._metadataOpts)
      this.db = this.db || new MountableHypertrie(this.corestore, this.key, {
        feed: this.metadata,
        sparse: this.sparseMetadata,
        extension: this.opts.extension !== false,
        subtype: this.subtype
      })
      this.db.on('hypertrie', onhypertrie)
      this.db.on('error', onerror)

      self.metadata.on('error', onerror)
      self.metadata.on('append', update)
      self.metadata.on('extension', extension)
      self.metadata.on('peer-add', peeradd)
      self.metadata.on('peer-open', peeropen)
      self.metadata.on('peer-remove', peerremove)

      this._unlistens.push(() => {
        self.db.removeListener('error', onerror)
        self.db.removeListener('hypertrie', onhypertrie)
        self.metadata.removeListener('error', onerror)
        self.metadata.removeListener('append', update)
        self.metadata.removeListener('extension', extension)
        self.metadata.removeListener('peer-add', peeradd)
        self.metadata.removeListener('peer-open', peeropen)
        self.metadata.removeListener('peer-remove', peerremove)
      })

      return self.metadata.ready(err => {
        if (err) return done(err)

        /**
        * TODO: Update comment to reflect mounts.
        *
        * If a db is provided as input, ensure that a contentFeed is also provided, then return (this is a checkout).
        * If the metadata feed is writable:
        *    If the metadata feed has length 0, then the db should be initialized with the content feed key as metadata.
        *    Else, initialize the db without metadata and load the content feed key from the header.
        * If the metadata feed is readable:
        *    Initialize the db without metadata and load the content feed key from the header.
        */
        if (self.metadata.writable && !self.metadata.length && !self.isCheckout) {
          initialize()
        } else {
          restore()
        }
      })
    })

    /**
     * The first time the hyperdrive is created, we initialize both the db (metadata feed) and the content feed here.
     */
    function initialize () {
      const contentName = self.metadata.key.toString('hex') + '-content'
      self._contentStateFromOpts({ name: contentName }, (err, contentState) => {
        if (err) return done(err)
        // warm up the thunky map
        self._contentStates.cache.set(self.db.feed, contentState)
        self.db.setMetadata(contentState.feed.key)
        self.db.ready(err => {
          if (err) return done(err)
          return done(null)
        })
      })
    }

    /**
     * If the hyperdrive has already been created, wait for the db (metadata feed) to load.
     * If the metadata feed is writable, we can immediately load the content feed from its private key.
     * (Otherwise, we need to read the feed's metadata block first)
     */
    function restore (keyPair) {
      self.db.ready(err => {
        if (err) return done(err)
        self.metadata.has(0, (err, hasMetadataBlock) => {
          if (err) return done(err)
          if (hasMetadataBlock) self._getContent(self.db.feed, done)
          else done(null)
        })
      })
    }

    function done (err) {
      if (err) return cb(err)
      self.key = self.metadata.key
      self.discoveryKey = self.metadata.discoveryKey
      return cb(null)
    }

    function onerror (err) {
      if (err) self.emit('error', err)
      return cb(err)
    }

    function update () {
      self.emit('update')
    }

    function extension(name, message, peer) {
      self.emit('extension', name, message, peer)
    }

    function peeradd(peer) {
      self.emit('peer-add', peer)
    }

    function peeropen(peer) {
      self.emit('peer-open', peer)
    }

    function peerremove(peer) {
      self.emit('peer-remove', peer)
    }

    function onhypertrie (trie) {
      self.emit('metadata-feed', trie.feed)
      self.emit('mount', trie)
    }
  }

  _getContent (metadata, cb) {
    this._contentStates.get(metadata, cb)
  }

  _contentStateFromMetadata (metadata, cb) {
    MountableHypertrie.getMetadata(metadata, (err, publicKey) => {
      if (err) return cb(err)
      this._contentStateFromKey(publicKey, cb)
    })
  }

  _contentStateFromKey (publicKey, cb) {
    this._contentStateFromOpts({ key: publicKey }, cb)
  }

  _contentStateFromOpts (opts, cb) {
    const contentOpts = { ...opts, ...contentOptions(this), cache: { data: false } }
    
    try {
      var feed = this.corestore.get(contentOpts)
    } catch (err) {
      return cb(err)
    }

    const contentErrorListener = err => this.emit('error', err)
    feed.on('error', contentErrorListener)
    this._unlistens.push(() => feed.removeListener('error', contentErrorListener))
    feed.ready(err => {
      if (err) return cb(err)
      this.emit('content-feed', feed)
      return cb(null, new ContentState(feed))
    })
  }

  _putStat (name, stat, opts, cb) {
    if (typeof opts === 'function') return this._putStat(name, stat, null, opts)
    try {
      var encoded = stat.encode()
    } catch (err) {
      return cb(err)
    }
    this.db.put(name, encoded, opts, err => {
      if (err) return cb(err)
      return cb(null, stat)
    })
  }

  _update (name, stat, cb) {
    name = fixName(name)

    this.db.get(name, (err, st) => {
      if (err) return cb(err)
      if (!st) return cb(new errors.FileNotFound(name))
      try {
        var decoded = Stat.decode(st.value)
      } catch (err) {
        return cb(err)
      }
      const oldMetadata = decoded.metadata
      const newStat = Object.assign(decoded, stat)
      if (stat.metadata) {
        newStat.metadata = Object.assign({}, oldMetadata || {}, stat.metadata)
      }
      return this._putStat(name, newStat, { flags: st.flags }, cb)
    })
  }

  _upsert (name, stat, cb) {
    name = fixName(name)

    this.db.get(name, (err, st) => {
      if (err) return cb(err)
      if (!st) {
        var decoded = Stat.file()
      }
      else {
        try {
          var decoded = Stat.decode(st.value)
        } catch (err) {
          return cb(err)
        }
      }
      const oldMetadata = decoded.metadata
      const newStat = Object.assign(decoded, stat)
      if (stat.metadata) {
        newStat.metadata = Object.assign({}, oldMetadata || {}, stat.metadata)
      }
      return this._putStat(name, newStat, { flags: st ? st.flags : 0 }, cb)
    })
  }

  getContent (cb) {
    if (!this.db) return cb(null, null)
    this._getContent(this.db.feed, (err, contentState) => {
      if (err) return cb(err)
      return cb(null, contentState.feed)
    })
  }

  open (name, flags, cb) {
    if (!name || typeof name === 'function') return super.open(name)
    name = fixName(name)

    this.ready(err => {
      if (err) return cb(err)
      createFileDescriptor(this, name, flags, (err, fd) => {
        if (err) return cb(err)
        cb(null, STDIO_CAP + (this._fds.push(fd) - 1) * 2)
      })
    })
  }

  read (fd, buf, offset, len, pos, cb) {
    if (typeof pos === 'function') {
      cb = pos
      pos = null
    }

    const desc = this._fds[(fd - STDIO_CAP) / 2]
    if (!desc) return process.nextTick(cb, new errors.BadFileDescriptor(`Bad file descriptor: ${fd}`))
    if (pos == null) pos = desc.position
    desc.read(buf, offset, len, pos, cb)
  }

  write (fd, buf, offset, len, pos, cb) {
    if (typeof pos === 'function') {
      cb = pos
      pos = null
    }

    const desc = this._fds[(fd - STDIO_CAP) / 2]
    if (!desc) return process.nextTick(cb, new errors.BadFileDescriptor(`Bad file descriptor: ${fd}`))
    if (pos == null) pos = desc.position
    desc.write(buf, offset, len, pos, cb)
  }

  createReadStream (name, opts) {
    if (!opts) opts = {}
    const self = this

    name = fixName(name)

    const length = typeof opts.end === 'number' ? 1 + opts.end - (opts.start || 0) : typeof opts.length === 'number' ? opts.length : -1
    const stream = coreByteStream({
      ...opts,
      highWaterMark: opts.highWaterMark || 64 * 1024
    })

    this.ready(err => {
      if (err) return stream.destroy(err)
      return this.stat(name, { file: true }, (err, st, trie) => {
        if (err) return stream.destroy(err)
        if (st.mount && st.mount.hypercore) {
          const feed = self.corestore.get({
            key: st.mount.key,
            sparse: self.sparse
          })
          return feed.ready(err => {
            if (err) return stream.destroy(err)
            st.blocks = feed.length
            return oncontent(st, { feed })
          })
        }
        return this._getContent(trie.feed, (err, contentState) => {
          if (err) return stream.destroy(err)
          return oncontent(st, contentState)
        })
      })
    })

    function oncontent (st, contentState) {
      if (st.mount && st.mount.hypercore) {
        var byteOffset = 0
        var blockOffset = 0
        var blockLength = st.blocks
      } else {
        blockOffset = st.offset
        blockLength = st.blocks
        byteOffset = opts.start ? st.byteOffset + opts.start : (length === -1 ? -1 : st.byteOffset)
      }

      const byteLength = Math.min(length, st.size)

      stream.start({
        feed: contentState.feed,
        blockOffset,
        blockLength,
        byteOffset,
        byteLength
      })
    }

    return stream
  }

  createDiffStream (other, prefix, opts) {
    if (other instanceof Hyperdrive) other = other.version
    if (typeof prefix === 'object') return this.createDiffStream(other, '/', prefix)
    prefix = prefix || '/'

    const diffStream = this.db.createDiffStream(other, prefix, opts)
    return pumpify.obj(
      diffStream,
      new Transform({
        transform (chunk, cb) {
          const entry = { type: chunk.type, name: chunk.key }
          if (chunk.left) entry.seq = chunk.left.seq
          if (chunk.right) entry.previous = { seq: chunk.right.seq }
          if (chunk.left && entry.type !== 'mount' && entry.type !== 'unmount') {
            try {
              entry.value = Stat.decode(chunk.left.value)
            } catch (err) {
              return cb(err)
            }
          } else if (chunk.left) {
            entry.value = chunk.left.info
          }
          return cb(null, entry)
        }
      })
    )
  }

  createDirectoryStream (name, opts) {
    if (!opts) opts = {}
    name = fixName(name)
    return createReaddirStream(this, name, {
      ...opts,
      includeStats: true
    })
  }

  createWriteStream (name, opts) {
    if (!opts) opts = {}
    name = fixName(name)

    const self = this
    var release

    const proxy = duplexify()
    proxy.setReadable(false)

    // TODO: support piping through a "split" stream like rabin

    this.ready(err => {
      if (err) return proxy.destroy(err)
      this.stat(name, { trie: true }, (err, stat, trie) => {
        if (err && (err.errno !== 2)) return proxy.destroy(err)
        this._getContent(trie.feed, (err, contentState) => {
          if (err) return proxy.destroy(err)
          if (opts.wait === false && contentState.isLocked()) return cb(new Error('Content is locked.'))
          contentState.lock(_release => {
            release = _release
            append(contentState)
          })
        })
      })
    })

    return proxy

    function append (contentState) {
      if (proxy.destroyed) return release()

      const byteOffset = contentState.feed.byteLength
      const offset = contentState.feed.length

      self.emit('appending', name, opts)

      // TODO: revert the content feed if this fails!!!! (add an option to the write stream for this (atomic: true))
      const stream = contentState.feed.createWriteStream({ maxBlockSize: WRITE_STREAM_BLOCK_SIZE })

      proxy.on('close', ondone)
      proxy.on('finish', ondone)

      proxy.setWritable(stream)
      proxy.on('prefinish', function () {
        const stat = Stat.file({
          ...opts,
          offset,
          byteOffset,
          size: contentState.feed.byteLength - byteOffset,
          blocks: contentState.feed.length - offset
        })
        proxy.cork()
        self._putStat(name, stat, function (err) {
          if (err) return proxy.destroy(err)
          self.emit('append', name, opts)
          proxy.uncork()
        })
      })
    }

    function ondone () {
      proxy.removeListener('close', ondone)
      proxy.removeListener('finish', ondone)
      release()
    }
  }

  create (name, opts, cb) {
    if (typeof opts === 'function') return this.create(name, null, opts)

    name = fixName(name)

    this.ready(err => {
      if (err) return cb(err)
      this.lstat(name, { file: true, trie: true }, (err, stat) => {
        if (err && err.errno !== 2) return cb(err)
        if (stat) return cb(null, stat)
        const st = Stat.file(opts)
        return this._putStat(name, st, cb)
      })
    })
  }

  readFile (name, opts, cb) {
    if (typeof opts === 'function') return this.readFile(name, null, opts)
    if (typeof opts === 'string') opts = { encoding: opts }
    if (!opts) opts = {}

    name = fixName(name)

    collect(this.createReadStream(name, opts), function (err, bufs) {
      if (err) return cb(err)
      let buf = bufs.length === 1 ? bufs[0] : Buffer.concat(bufs)
      cb(null, opts.encoding && opts.encoding !== 'binary' ? buf.toString(opts.encoding) : buf)
    })
  }

  writeFile (name, buf, opts, cb) {
    if (typeof opts === 'function') return this.writeFile(name, buf, null, opts)
    if (typeof opts === 'string') opts = { encoding: opts }
    if (!opts) opts = {}
    if (typeof buf === 'string') buf = Buffer.from(buf, opts.encoding || 'utf-8')
    if (!cb) cb = noop

    name = fixName(name)

    // Make sure that the buffer is chunked into blocks of 0.5MB.
    let stream = this.createWriteStream(name, opts)

    // TODO: Do we need to maintain the error state? What's triggering 'finish' after 'error'?
    var errored = false

    stream.on('error', err => {
      errored = true
      return cb(err)
    })
    stream.on('finish', () => {
      if (!errored) return cb(null)
    })
    stream.end(buf)
  }

  truncate (name, size, cb) {
    name = fixName(name)

    this.lstat(name, { file: true, trie: true }, (err, st) => {
      if (err && err.errno !== 2) return cb(err)
      if (!st || !size) return this.create(name, cb)
      if (size === st.size) return cb(null)
      if (size < st.size) {
        const readStream = this.createReadStream(name, { length: size })
        const writeStream = this.createWriteStream(name)
        return pump(readStream, writeStream, cb)
      } else {
        this.open(name, 'a', (err, fd) => {
          if (err) return cb(err)
          const length = size - st.size
          this.write(fd, Buffer.alloc(length), 0, length, st.size, err => {
            if (err) return cb(err)
            this.close(fd, cb)
          })
        })
      }
    })
  }

  ftruncate (fd, size, cb) {
    const desc = this._fds[(fd - STDIO_CAP) / 2]
    if (!desc) return process.nextTick(cb, new errors.BadFileDescriptor(`Bad file descriptor: ${fd}`))
    return desc.truncate(size, cb)
  }

  _createStat (name, opts, cb) {
    const self = this

    const statConstructor = (opts && opts.directory) ? Stat.directory : Stat.file
    const shouldForce = !!opts.force

    this.ready(err => {
      if (err) return cb(err)
      this.db.get(name, (err, node, trie) => {
        if (err) return cb(err)
        if (node && !shouldForce) return cb(new errors.PathAlreadyExists(name))
        onexisting(node, trie)
      })
    })

    function onexisting (node, trie) {
      self.ready(err => {
        if (err) return cb(err)
        self._getContent(trie.feed, (err, contentState) => {
          if (err) return cb(err)
          const st = statConstructor({
            ...opts,
            offset: contentState.feed.length,
            byteOffset: contentState.feed.byteLength
          })
          return cb(null, st)
        })
      })
    }
  }

  mkdir (name, opts, cb) {
    if (typeof opts === 'function') return this.mkdir(name, null, opts)
    if (typeof opts === 'number') opts = { mode: opts }
    if (!opts) opts = {}
    if (!cb) cb = noop

    name = fixName(name)
    opts.directory = true

    this._createStat(name, opts, (err, st) => {
      if (err) return cb(err)
      this._putStat(name, st, {
        condition: ifNotExists
      }, cb)
    })
  }

  _statDirectory (name, opts, cb) {
    const ite = this.db.iterator(name)
    ite.next((err, st) => {
      if (err) return cb(err)
      if (name !== '/' && !st) return cb(new errors.FileNotFound(name))
      if (name === '/') return cb(null, Stat.directory(), this.db)
      const trie = st[MountableHypertrie.Symbols.TRIE]
      const mount = st[MountableHypertrie.Symbols.MOUNT]
      const innerPath = st[MountableHypertrie.Symbols.INNER_PATH]
      try {
        st = Stat.decode(st.value)
      } catch (err) {
        return cb(err)
      }
      const noMode = Object.assign({}, st, { mode: 0 })
      return cb(null, Stat.directory(noMode), trie, mount, innerPath)
    })
  }

  readlink (name, cb) {
    this.lstat(name, function (err, st) {
      if (err) return cb(err)
      cb(null, st.linkname)
    })
  }

  lstat (name, opts, cb) {
    if (typeof opts === 'function') return this.lstat(name, null, opts)
    if (!opts) opts = {}
    const self = this
    name = fixName(name)

    this.ready(err => {
      if (err) return cb(err)
      this.db.get(name, opts, onstat)
    })

    function onstat (err, node, trie, mount, mountPath) {
      if (err) return cb(err)
      if (!node && opts.trie) return cb(null, null, trie, mount, mountPath)
      if (!node && opts.file) return cb(new errors.FileNotFound(name))
      if (!node) return self._statDirectory(name, opts, cb)
      try {
        var st = Stat.decode(node.value)
      } catch (err) {
        return cb(err)
      }
      const writingFd = self._writingFds.get(name)
      if (writingFd) {
        st.size = writingFd.stat.size
      }
      cb(null, st, trie, mount, mountPath)
    }
  }

  stat (name, opts, cb) {
    if (typeof opts === 'function') return this.stat(name, null, opts)
    if (!opts) opts = {}

    this.lstat(name, opts, (err, stat, trie, mount, mountPath) => {
      if (err) return cb(err)
      if (!stat) return cb(null, null, trie, name, mount, mountPath)
      if (stat.linkname) {
        if (path.isAbsolute(stat.linkname)) return this.stat(stat.linkname, opts, cb)
        const relativeStat = path.resolve('/', path.dirname(name), stat.linkname)
        return this.stat(relativeStat, opts, cb)
      }
      return cb(null, stat, trie, name, mount, mountPath)
    })
  }

  info (name, cb) {
    name = fixName(name)
    const noopPath = path.join(name, NOOP_FILE_PATH)
    this.stat(noopPath, { trie: true }, (err, stat, trie, _, mountInfo, mountPath) => {
      if (err) return cb(err)
      return cb(null, {
        feed: trie.feed,
        mountPath: fixName(noopPath.slice(0, noopPath.length - mountPath.length)),
        mountInfo
      })
    })
  }

  access (name, opts, cb) {
    if (typeof opts === 'function') return this.access(name, null, opts)
    if (!opts) opts = {}
    name = fixName(name)

    this.stat(name, opts, err => {
      cb(err)
    })
  }

  exists (name, opts, cb) {
    if (typeof opts === 'function') return this.exists(name, null, opts)
    if (!opts) opts = {}

    this.access(name, opts, err => {
      cb(!err)
    })
  }

  readdir (name, opts, cb) {
    if (typeof opts === 'function') return this.readdir(name, null, opts)
    name = fixName(name)

    const readdirStream = createReaddirStream(this, name, opts)
    return collect(readdirStream, (err, entries) => {
      if (err) return cb(err)
      return cb(null, entries)
    })
  }

  _del (name, cb) {
    this.ready(err => {
      if (err) return cb(err)
      this.db.del(name, (err, node) => {
        if (err) return cb(err)
        if (!node) return cb(new errors.FileNotFound(name))
        return cb(null)
      })
    })
  }

  unlink (name, cb) {
    name = fixName(name)
    this._del(name, cb || noop)
  }

  rmdir (name, opts, cb) {
    if (typeof opts === 'function') cb = opts
    if (!cb) cb = noop

    name = fixName(name)

    const recursive = !!(opts && opts.recursive)
    const ite = readdirIterator(this, name, opts)

    const onItem = (err, val) => {
      if (err) return cb(err)
      let key = name

      if (recursive) {
        if (val === null) return cb(null)
        key = path.join(name, val)
      } else if (val) {
        return cb(new errors.DirectoryNotEmpty(name))
      }

      this._del(key, err => {
        if (err) return cb(err)
        if (!recursive) return cb(null)
        ite.next(onItem)
      })
    }

    ite.next(onItem)
  }

  replicate (isInitiator, opts) {
    // support replicate({ initiator: bool }) also
    if (typeof isInitiator === 'object' && isInitiator && !opts) {
      opts = isInitiator
      isInitiator = !!opts.initiator
    }
    const stream = (opts && opts.stream) || new HypercoreProtocol(isInitiator, { ...opts })
    this.ready(err => {
      if (err) return stream.destroy(err)
      this.corestore.replicate(isInitiator, { ...opts, stream })
    })
    return stream
  }

  checkout (version, opts) {
    opts = {
      ...opts,
      _db: this.db.checkout(version),
      _contentStates: this._contentStates,
    }
    return new Hyperdrive(this.corestore, this.key, opts)
  }

  _closeFile (fd, cb) {
    const idx = (fd - STDIO_CAP) / 2
    const desc = this._fds[idx]
    if (!desc) return process.nextTick(cb, new Error('Invalid file descriptor'))
    this._fds[idx] = null
    while (this._fds.length && !this._fds[this._fds.length - 1]) this._fds.pop()
    desc.close(cb)
  }

  _close (cb) {
    this.db.close(err => {
      for (const unlisten of this._unlistens) {
        unlisten()
      }
      this._unlistens = []
      this.emit('close')
      cb(err)
    })
  }

  close (fd, cb) {
    if (typeof fd === 'number') return this._closeFile(fd, cb || noop)
    super.close(false, fd)
  }

  destroyStorage (cb) {
    const metadata  = this.db.feed
    this._getContent(metadata, (err, contentState) => {
      const content = contentState.feed
      metadata.destroyStorage(() => {
        content.destroyStorage(() => {
          this.close(cb)
        })
      })
    })
  }

  stats (path, opts, cb) {
    if (typeof opts === 'function') return this.stats(path, null, opts)
    const self = this
    const stats = new Map()

    this.stat(path, (err, stat, trie) => {
      if (err) return cb(err)
      if (stat.isFile()) {
        return fileStats(path, cb)
      } else {
        const recursive = opts && (opts.recursive !== false)
        const ite = statIterator(self, path, { recursive })
        return ite.next(function loop (err, info) {
          if (err) return cb(err)
          if (!info) return cb(null, stats)
          fileStats(info.path, (err, fileStats) => {
            if (err && err.errno !== 2) return cb(err)
            if (!fileStats) return ite.next(loop)
            stats.set(info.path, fileStats)
            return ite.next(loop)
          })
        })
      }
    })

    function onstats (err, path, fileStats) {
      if (err) return cb(err)
      stats.set(path, fileStats)
    }

    function fileStats (path, cb) {
      const total = emptyStats()
      return self.stat(path, (err, stat, trie) => {
        if (err) return cb(err)
        return self._getContent(trie.feed, (err, contentState) => {
          if (err) return cb(err)
          contentState.feed.downloaded(stat.offset, stat.offset + stat.blocks, (err, downloadedBlocks) => {
            if (err) return cb(err)
            total.blocks = stat.blocks
            total.size = stat.size
            total.downloadedBlocks = downloadedBlocks
            // TODO: This is not possible to implement now. Need a better byte length index in hypercore.
            // total.downloadedBytes = 0
            return cb(null, total)
          })
        })
      })
    }

    function emptyStats () {
      return {
        blocks: 0,
        size: 0,
        downloadedBlocks: 0,
      }
    }
  }

  watchStats (path, opts) {
    const self = this
    var timer = setInterval(collectStats, (opts && opts.statsInveral) || 2000)
    var collecting = false
    var destroyed = false

    const handle = new EventEmitter()
    Object.assign(handle, {
      destroy
    })
    return handle

    function collectStats () {
      if (collecting) return
      collecting = true
      self.stats(path, opts, (err, stats) => {
        if (err) return destroy(err)
        collecting = false
        handle.stats = stats
        handle.emit('update')
      })
    }

    function destroy (err) {
      handle.emit('destroy', err)
      clearInterval(timer)
      destroyed = true
    }
  }

  mirror () {
    const self = this
    if (this._unmirror) return this._unmirror
    const mirrorRanges = new Map()

    this.on('content-feed', oncore)
    this.on('metadata-feed', oncore)
    this.getAllMounts({ content: true }, (err, mounts) => {
      if (err) return this.emit('error', err)
      for (const { metadata, content } of mounts.values()) {
        oncore(metadata)
        oncore(content)
      }
    })

    this._unmirror = unmirror
    return this._unmirror

    function unmirror () {
      if (!self._unmirror) return
      self._unmirror = null
      self.removeListener('content-feed', oncore)
      self.removeListener('metadata-feed', oncore)
      for (const [ core, range ] of mirrorRanges) {
        core.undownload(range)
      }
    }

    function oncore (core) {
      if (!core) return
      if (!self._unmirror || self._unmirror !== unmirror || mirrorRanges.has(core)) return
      mirrorRanges.set(core, core.download({ start: 0, end: -1 }))
    }
  }

  clear (path, opts, cb) {
    if (typeof opts === 'function') {
      cb = opts
      opts = null
    }
    opts = opts || {}
    if (!cb) cb = noop
    opts.on = (feed, range, cb) => {
      feed.clear(range.start, range.end, cb)
      return range
    }

    opts.off = noop

    return this._walk(path, opts, cb)
  }

  download (path, opts, cb) {
    if (typeof opts === 'function') {
      cb = opts
      opts = null
    }
    opts = opts || {}
    if (!cb) cb = noop
    opts.on = (feed, range, cb) => {
      return feed.download(range, cb)
    }

    opts.off = (feed, range) => {
      return feed.undownload(range)
    }

    return this._walk(path, opts, cb)
  }

  _walk (path, opts, cb) {
    if (!opts.on || !opts.off) throw new Error('_walk requires on and off')
    if (!cb) cb = noop

    const self = this
    const ranges = new Map()
    var pending = 0
    var destroyed = false

    const handle = new EventEmitter()
    Object.assign(handle, {
      destroy
    })

    self.stat(path, (err, stat, trie) => {
      if (err) return destroy(err)
      if (stat.isFile()) {
        downloadFile(path, stat, trie, destroy)
      } else {
        const recursive = opts.recursive !== false
        const noMounts = opts.noMounts !== false
        const ite = statIterator(self, path, { recursive, noMounts, random: true })
        downloadNext(ite)
      }
    })

    return handle

    function downloadNext (ite) {
      if (destroyed) return
      ite.next((err, info) => {
        if (err) return destroy(err)
        if (!info) {
          if (!ranges.size) return destroy(null)
          else return
        }
        const { path, stat, trie } = info
        if (!stat.blocks || stat.mount || stat.isDirectory()) return downloadNext(ite)
        downloadFile(path, stat, trie, err => {
          if (err) return destroy(err)
          return downloadNext(ite)
        })
        if (pending < ((opts && opts.maxConcurrent) || 50)) {
          return downloadNext(ite)
        }
      })
    }

    function downloadFile (path, stat, trie, cb) {
      pending++
      self._getContent(trie.feed, (err, contentState) => {
        if (err) return destroy(err)
        const feed = contentState.feed
        const range = opts.on(feed, {
          start: stat.offset,
          end: stat.offset + stat.blocks
        }, err => {
          pending--
          if (err) return cb(err)
          ranges.delete(path)
          return cb(null)
        })
        ranges.set(path, { range, feed })
      })
    }

    function destroy (err) {
      if (destroyed) return null
      destroyed = true
      for (const [path, { feed, range }] of ranges) {
        opts.off(feed, range)
      }
      if (err) return cb(err)
      return cb(null)
    }
  }

  watch (name, onchange) {
    name = fixName(name)
    return this.db.watch(name, onchange)
  }

  mount (path, key, opts, cb) {
    if (typeof opts === 'function') return this.mount(path, key, null, opts)
    const self = this

    path = fixName(path)
    opts = opts || {}

    const statOpts = {
      uid: opts.uid,
      gid: opts.gid
    }
    statOpts.mount = {
      key,
      version: opts.version,
      hash: opts.hash,
      hypercore: !!opts.hypercore
    }
    statOpts.directory = !opts.hypercore

    if (opts.hypercore) {
      const core = this.corestore.get({
        key,
        ...opts,
        parents: [this.key],
        sparse: this.sparse
      })
      core.ready(err => {
        if (err) return cb(err)
        this.emit('content-feed', core)
        statOpts.size = core.byteLength
        statOpts.blocks = core.length
        return mountCore()
      })
    } else {
      return process.nextTick(mountTrie, null)
    }

    function mountCore () {
      self._createStat(path, statOpts, (err, st) => {
        if (err) return cb(err)
        return self.db.put(path, st.encode(), cb)
      })
    }

    function mountTrie () {
      self._createStat(path, statOpts, (err, st) => {
        if (err) return cb(err)
        self.db.mount(path, key, { ...opts, value: st.encode() }, err => {
          return self.db.loadMount(path, cb)
        })
      })
    }
  }

  unmount (path, cb) {
    this.stat(path, (err, st) => {
      if (err) return cb(err)
      if (!st.mount) return cb(new Error('Can only unmount mounts.'))
      if (st.mount.hypercore) {
        return this.unlink(path, cb)
      } else {
        return this.db.unmount(path, cb)
      }
    })
  }

  symlink (target, linkName, cb) {
    target = unixify(target)
    linkName = fixName(linkName)

    this.lstat(linkName, (err, stat) => {
      if (err && (err.errno !== 2)) return cb(err)
      if (!err) return cb(new errors.PathAlreadyExists(linkName))
      const st = Stat.symlink({
        linkname: target
      })
      return this._putStat(linkName, st, cb)
    })
  }

  createMountStream (opts) {
    return createMountStream(this, opts)
  }

  getAllMounts (opts, cb) {
    if (typeof opts === 'function') return this.getAllMounts(null, opts)
    const mounts = new Map()

    this.ready(err => {
      if (err) return cb(err)
      collect(this.createMountStream(opts), (err, mountList) => {
        if (err) return cb(err)
        for (const { path, metadata, content } of mountList) {
          mounts.set(path, { metadata, content })
        }
        return cb(null, mounts)
      })
    })
  }

  extension (name, message) {
    this.metadata.extension(name, message)
  }

  registerExtension (name, handlers) {
    return this.metadata.registerExtension(name, handlers)
  }

  get peers () {
    return this.metadata.peers
  }

  setMetadata (path, key, value, cb) {
    const metadata = {}
    metadata[key] = value
    this._update(path, { metadata }, cb)
  }

  removeMetadata (path, key, cb) {
    const metadata = {}
    metadata[key] = null
    this._update(path, { metadata }, cb)
  }

  copy (from, to, cb) {
    this.stat(from, (err, stat) => {
      if (err) return cb(err)
      this.create(to, stat, cb)
    })
  }

  // Tag-related methods.

  createTag (name, version, cb) {
    return this.tags.create(name, version, cb)
  }

  getAllTags (cb) {
    return this.tags.getAll(cb)
  }

  deleteTag (name, cb) {
    return this.tags.delete(name, cb)
  }

  getTaggedVersion (name, cb) {
    return this.tags.get(name, cb)
  }
}

function HyperdriveCompat (...args) {
  if (!(this instanceof HyperdriveCompat)) return new HyperdriveCompat(...args)
  Nanoresource.call(this)
  Hyperdrive.prototype._initialize.call(this, ...args)
}
Object.setPrototypeOf(HyperdriveCompat.prototype, Hyperdrive.prototype)

function isObject (val) {
  return !!val && typeof val !== 'string' && !Buffer.isBuffer(val)
}

function ifNotExists (oldNode, newNode, cb) {
  if (oldNode) return cb(new errors.PathAlreadyExists(oldNode.key))
  return cb(null, true)
}

function fixName (name) {
  name = unixify(name)
  if (!name.startsWith('/')) name = '/' + name
  return name
}

function noop () {}
