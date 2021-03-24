/**
 * A promisified version of the Hyperdrive API
 *
 * Note: The promises API does not currently include file descriptor operations.
*/

module.exports = class HyperdrivePromises {
  constructor (drive) {
    this.drive = drive
  }

  get key () {
    return this.drive.key
  }
  get discoveryKey () {
    return this.drive.discoveryKey
  }
  get version () {
    return this.drive.version
  }
  get metadata () {
    return this.drive.metadata
  }
  get writable () {
    return this.drive.metadata.writable
  }

  ready () {
    return new Promise((resolve, reject) => {
      this.drive.ready(err => {
        if (err) return reject(err)
        return resolve(null)
      })
    })
  }

  close () {
    return new Promise((resolve, reject) => {
      this.drive.close(err => {
        if (err) return reject(err)
        return resolve(null)
      })
    })
  }

  create (name, opts) {
    return new Promise((resolve, reject) => {
      this.drive.create(name, opts, (err, st) => {
        if (err) return reject(err)
        return resolve(st)
      })
    })

  }

  createReadStream (name, opts) {
    return this.drive.createReadStream(name, opts)
  }

  readFile (name, opts) {
    return new Promise((resolve, reject) => {
      this.drive.readFile(name, opts, (err, contents) => {
        if (err) return reject(err)
        return resolve(contents)
      })
    })
  }

  createWriteStream (name, opts) {
    return this.drive.createWriteStream(name, opts)
  }

  writeFile (name, buf, opts) {
    return new Promise((resolve, reject) => {
      this.drive.writeFile(name, buf, opts, err => {
        if (err) return reject(err)
        return resolve(null)
      })
    })

  }

  createDiffStream (other, prefix, opts) {
    return this.drive.createDiffStream(other, prefix, opts)
  }

  createDirectoryStream (name, opts) {
    return this.drive.createDirectoryStream(name, opts)
  }

  replicate (isInitiator, opts) {
    return this.drive.replicate(isInitiator, opts)
  }

  truncate (name, size) {
    return new Promise((resolve, reject) => {
      this.drive.truncate(name, size, err => {
        if (err) return reject(err)
        return resolve(null)
      })
    })

  }

  mkdir (name, opts) {
    return new Promise((resolve, reject) => {
      this.drive.mkdir(name, opts, (err, st) => {
        if (err) return reject(err)
        return resolve(st)
      })
    })

  }

  lstat (name, opts) {
    return new Promise((resolve, reject) => {
      this.drive.lstat(name, opts, (err, st) => {
        if (err) return reject(err)
        return resolve(st)
      })
    })
  }

  stat (name, opts) {
    return new Promise((resolve, reject) => {
      this.drive.stat(name, opts, (err, st) => {
        if (err) return reject(err)
        return resolve(st)
      })
    })
  }

  info (name) {
    return new Promise((resolve, reject) => {
      this.drive.info(name, (err, info) => {
        if (err) return reject(err)
        return resolve(info)
      })
    })
  }

  access (name, opts) {
    return new Promise((resolve, reject) => {
      this.drive.access(name, opts, err => {
        if (err) return reject(err)
        return resolve(null)
      })
    })
  }

  exists (name, opts) {
    return new Promise((resolve, reject) => {
      this.drive.exists(name, opts, (exists) => {
        return resolve(exists)
      })
    })
  }

  readdir (name, opts) {
    return new Promise((resolve, reject) => {
      this.drive.readdir(name, opts, (err, entries) => {
        if (err) return reject(err)
        return resolve(entries)
      })
    })

  }

  unlink (name) {
    return new Promise((resolve, reject) => {
      this.drive.unlink(name, err => {
        if (err) return reject(err)
        return resolve(null)
      })
    })
  }

  rmdir (name, opts) {
    return new Promise((resolve, reject) => {
      this.drive.rmdir(name, opts, err => {
        if (err) return reject(err)
        return resolve(null)
      })
    })
  }

  checkout (version, opts) {
    return this.drive.checkout(version, opts).promises
  }

  destroyStorage () {
    return new Promise((resolve, reject) => {
      this.drive.destroyStorage(err => {
        if (err) return reject(err)
        return resolve(null)
      })
    })
  }

  stats (path, opts) {
    return new Promise((resolve, reject) => {
      this.drive.stats(path, opts, (err, stats) => {
        if (err) return reject(err)
        return resolve(stats)
      })
    })
  }

  watchStats (path, opts) {
    return this.drive.watchStats(path, opts)
  }

  mirror () {
    return this.drive.mirror()
  }

  download (path, opts) {
    var handle = null
    const prom = new Promise((resolve, reject) => {
      handle = this.drive.download(path, opts, err => {
        if (err) return reject(err)
        return resolve(handle)
      })
    })
    prom.destroy = handle.destroy
    prom.catch(() => {})
    return prom
  }

  watch (name, onchange) {
    return this.drive.watch(name, onchange)
  }

  mount (path, key, opts) {
    return new Promise((resolve, reject) => {
      this.drive.mount(path, key, opts, err => {
        if (err) return reject(err)
        return resolve(null)
      })
    })
  }

  extension (name, message) {
    return this.drive.extension(name, message)
  }

  createMountStream (opts) {
    return this.drive.createMountStream(opts)
  }

  unmount (path) {
    return new Promise((resolve, reject) => {
      this.drive.unmount(path, err => {
        if (err) return reject(err)
        return resolve(null)
      })
    })
  }

  symlink (target, linkname) {
    return new Promise((resolve, reject) => {
      this.drive.symlink(target, linkname, (err, st) => {
        if (err) return reject(err)
        return resolve(st)
      })
    })
  }

  readlink (name) {
    return new Promise((resolve, reject) => {
      this.drive.readlink(name, (err, linkname) => {
        if (err) return reject(err)
        return resolve(linkname)
      })
    })
  }

  getAllMounts (opts) {
    return new Promise((resolve, reject) => {
      this.drive.getAllMounts(opts, (err, allMounts) => {
        if (err) return reject(err)
        return resolve(allMounts)
      })
    })
  }

  setMetadata (path, key, value) {
    return new Promise((resolve, reject) => {
      this.drive.setMetadata(path, key, value, (err, st) => {
        if (err) return reject(err)
        return resolve(st)
      })
    })
  }

  removeMetadata (path, key) {
    return new Promise((resolve, reject) => {
      this.drive.removeMetadata(path, key, (err, st) => {
        if (err) return reject(err)
        return resolve(st)
      })
    })
  }

  copy (from, to) {
    return new Promise((resolve, reject) => {
      this.drive.copy(from, to, (err, st) => {
        if (err) return reject(err)
        return resolve(st)
      })
    })
  }

  createTag (name, version) {
    return new Promise((resolve, reject) => {
      this.drive.createTag(name, version, (err) => {
        if (err) return reject(err)
        return resolve(null)
      })
    })
  }

  getAllTags () {
    return new Promise((resolve, reject) => {
      this.drive.getAllTags((err, allTags) => {
        if (err) return reject(err)
        return resolve(allTags)
      })
    })
  }

  deleteTag (name) {
    return new Promise((resolve, reject) => {
      this.drive.deleteTag(name, (err) => {
        if (err) return reject(err)
        return resolve(null)
      })
    })

  }

  getTaggedVersion (name) {
    return new Promise((resolve, reject) => {
      this.drive.getTaggedVersion(name, (err, version) => {
        if (err) return reject(err)
        return resolve(version)
      })
    })
  }
}
