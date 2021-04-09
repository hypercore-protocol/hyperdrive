const test = require('tape')
const ram = require('random-access-memory')
const Corestore = require('corestore')

const Replicator = require('./helpers/replicator')
const create = require('./helpers/create')

test('single-file download', t => {
  const r = new Replicator(t)
  const drive1 = create()
  var drive2 = null

  drive1.ready(err => {
    t.error(err, 'no error')
    drive2 = create(drive1.key)
    drive2.ready(err => {
      t.error(err, 'no error')
      r.replicate(drive1, drive2)
      onready()
    })
  })

  function onready () {
    drive1.writeFile('hello', 'world', err => {
      t.error(err, 'no error')
      setImmediate(() => {
        drive2.stats('hello', (err, totals) => {
          t.error(err, 'no error')
          t.same(totals.blocks, 1)
          t.same(totals.downloadedBlocks, 0)
          drive2.download('hello', err => {
            t.error(err)
            drive2.stats('hello', (err, totals) => {
              t.same(totals.downloadedBlocks, 1)
              r.end()
            })
          })
        })
      })
    })
  }
})

test('download completion calls callback if provided', t => {
  const r = new Replicator(t)
  const drive1 = create()
  var drive2 = null

  drive1.ready(err => {
    t.error(err, 'no error')
    drive2 = create(drive1.key)
    drive2.ready(err => {
      t.error(err, 'no error')
      r.replicate(drive1, drive2)
      onready()
    })
  })

  function onready () {
    drive1.writeFile('hello', 'world', err => {
      t.error(err, 'no error')
      setImmediate(() => {
        drive2.stats('hello', (err, totals) => {
          t.error(err, 'no error')
          t.same(totals.blocks, 1)
          t.same(totals.downloadedBlocks, 0)
          const handle = drive2.download('hello', onfinished)
          ondownloading(handle)
        })
      })
    })
  }

  function onfinished () {
    drive2.stats('hello', (err, totals) => {
      t.same(totals.downloadedBlocks, 1)
      r.end()
    })
  }

  function ondownloading (handle) {
    handle.on('error', t.fail.bind(t))
    handle.on('cancel', t.fail.bind(t))
  }
})

test('directory download', t => {
  const r = new Replicator(t)
  const drive1 = create()
  var drive2 = null

  drive1.ready(err => {
    t.error(err, 'no error')
    drive2 = create(drive1.key)
    drive2.ready(err => {
      t.error(err, 'no error')
      r.replicate(drive1, drive2)
      onready()
    })
  })

  function onready () {
    drive1.writeFile('a/1', '1', err => {
      t.error(err, 'no error')
      drive1.writeFile('a/2', '2',err => {
        t.error(err, 'no error')
        drive1.writeFile('a/3', '3', err => {
          t.error(err, 'no error')
          drive2.download('a', { maxConcurrent: 1 }, err => {
            drive2.stats('a', (err, totals) => {
              t.error(err, 'no error')
              t.same(totals.get('/a/1').downloadedBlocks, 1)
              t.same(totals.get('/a/2').downloadedBlocks, 1)
              t.same(totals.get('/a/3').downloadedBlocks, 1)
              r.end()
            })
          })
        })
      })
    })
  }
})

test('test with no path as arg', t => {
  const r = new Replicator(t)
  const drive1 = create()
  var drive2 = null

  drive1.ready(err => {
    t.error(err, 'no error')
    drive2 = create(drive1.key)
    drive2.ready(err => {
      t.error(err, 'no error')
      r.replicate(drive1, drive2)
      onready()
    })
  })

  function onready () {
    drive1.writeFile('a/1', '1', err => {
      t.error(err, 'no error')
      drive1.writeFile('a/2', '2',err => {
        t.error(err, 'no error')
        drive1.writeFile('a/3', '3', err => {
          t.error(err, 'no error')
          drive2.download('', { maxConcurrent: 1 }, err => {
            drive2.stats('', (err, totals) => {
              t.error(err, 'no error')
              t.same(totals.get('/a/1').downloadedBlocks, 1)
              t.same(totals.get('/a/2').downloadedBlocks, 1)
              t.same(totals.get('/a/3').downloadedBlocks, 1)
              r.end()
            })
          })
        })
      })
    })
  }
})

test('download cancellation', t => {
  const r = new Replicator(t)
  const drive1 = create()
  var drive2 = null

  drive1.ready(err => {
    t.error(err, 'no error')
    drive2 = create(drive1.key)
    drive2.ready(err => {
      t.error(err, 'no error')
      r.replicate(drive1, drive2, { throttle: 50 })
      onready()
    })
  })

  function onready () {
    const writeStream = drive1.createWriteStream('a')
    var chunks = 100
    return write()

    function write () {
      writeStream.write(Buffer.alloc(1024 * 1024).fill('abcdefg'), err => {
        if (err) return t.fail(err)
        if (--chunks) return write()
        return writeStream.end(() => {
          return onwritten()
        })
      })
    }
  }

  function onwritten () {
    const handle = drive2.download('a', { detailed: true, statsInterval: 50 }, err => {
      if (err) t.fail(err)
      drive2.stats('a', (err, totals) => {
        t.error(err, 'no error')
        t.true(totals.downloadedBlocks > 0 && totals.downloadedBlocks < 100)
        r.end()
      })
    })
    drive2.getContent((err, content) => {
      t.error(err, 'no error')
      content.once('download', () => {
        handle.destroy()
      })
    })
  }
})

test('download omits mounts by default', t => {
  const r = new Replicator(t)
  const store = new Corestore(ram)
  var drive1, mount, drive2

  store.ready(() => {
    drive1 = create({ corestore: store, namespace: 'd1' })
    mount = create({ corestore: store, namespace: 'd2' })
    drive1.ready(() => {
      mount.ready(() => {
        drive2 = create(drive1.key)
        drive1.mount('b', mount.key, err => {
          t.error(err)
          drive2.ready(err => {
            t.error(err, 'no error')
            r.replicate(drive1, drive2)
            onready()
          })
        })
      })
    })
  })

  function onready () {
    mount.writeFile('hello', 'world', err => {
      t.error(err)
      drive1.writeFile('a/1', '1', err => {
        t.error(err, 'no error')
        drive1.writeFile('a/2', '2',err => {
          t.error(err, 'no error')
          drive1.writeFile('a/3', '3', err => {
            t.error(err, 'no error')
            drive2.download('/', { maxConcurrent: 1 }, err => {
              drive2.stats('a', (err, totals) => {
                t.error(err, 'no error')
                t.same(totals.get('/a/1').downloadedBlocks, 1)
                t.same(totals.get('/a/2').downloadedBlocks, 1)
                t.same(totals.get('/a/3').downloadedBlocks, 1)
                drive2.stats('b', (err, totals) => {
                  t.error(err, 'no error')
                  t.same(totals.get('/b/hello').downloadedBlocks, 0)
                  r.end()
                })
              })
            })
          })
        })
      })
    })
  }
})

test('download with noMounts false includes mounts', t => {
  const r = new Replicator(t)
  const store = new Corestore(ram)
  var drive1, mount, drive2

  store.ready(() => {
    drive1 = create({ corestore: store, namespace: 'd1' })
    mount = create({ corestore: store, namespace: 'd2' })
    drive1.ready(() => {
      mount.ready(() => {
        drive2 = create(drive1.key)
        drive1.mount('b', mount.key, err => {
          t.error(err)
          drive2.ready(err => {
            t.error(err, 'no error')
            r.replicate(drive1, drive2)
            onready()
          })
        })
      })
    })
  })

  function onready () {
    mount.writeFile('hello', 'world', err => {
      t.error(err)
      drive1.writeFile('a/1', '1', err => {
        t.error(err, 'no error')
        drive1.writeFile('a/2', '2',err => {
          t.error(err, 'no error')
          drive1.writeFile('a/3', '3', err => {
            t.error(err, 'no error')
            drive2.download('/', { maxConcurrent: 1, noMounts: false }, err => {
              drive2.stats('a', (err, totals) => {
                t.error(err, 'no error')
                t.same(totals.get('/a/1').downloadedBlocks, 1)
                t.same(totals.get('/a/2').downloadedBlocks, 1)
                t.same(totals.get('/a/3').downloadedBlocks, 1)
                drive2.stats('b', (err, totals) => {
                  t.error(err, 'no error')
                  t.same(totals.get('/b/hello').downloadedBlocks, 1)
                  r.end()
                })
              })
            })
          })
        })
      })
    })
  }
})

test('drive mirroring', t => {
  const r = new Replicator(t)
  const drive1 = create()
  var drive2 = null

  drive1.ready(err => {
    t.error(err, 'no error')
    drive2 = create(drive1.key)
    drive2.ready(err => {
      t.error(err, 'no error')
      r.replicate(drive1, drive2)
      onready()
    })
  })

  function onready () {
    drive1.writeFile('hello', 'world', () => {
      drive1.writeFile('hello', 'world2', () => {
        drive1.writeFile('hello', 'world3', () => {
          drive2.mirror()
          setImmediate(() => {
            onmirroring()
          })
        })
      })
    })
  }

  function onmirroring () {
    drive2.getContent((err, content) => {
      t.error(err, 'no error')
      // All versions of 'hello' should have been synced.
      t.same(content.downloaded(), 3)
      t.end()
    })
  }
})

test('can cancel a mirror', t => {
  const r = new Replicator(t)
  const drive1 = create()
  var drive2 = null

  drive1.ready(err => {
    t.error(err, 'no error')
    drive2 = create(drive1.key)
    drive2.ready(err => {
      t.error(err, 'no error')
      r.replicate(drive1, drive2)
      onready()
    })
  })

  function onready () {
    drive1.writeFile('hello', 'world', () => {
      drive1.writeFile('hello', 'world2', () => {
        const unmirror = drive2.mirror()
        setImmediate(() => {
          unmirror()
          drive1.writeFile('hello', 'world3', () => {
            setImmediate(() => {
              onmirroring()
            })
          })
        })
      })
    })
  }

  function onmirroring () {
    drive2.getContent((err, content) => {
      t.error(err, 'no error')
      // Only the first two versions of 'hello' should have been synced.
      t.same(content.downloaded(), 2)
      t.end()
    })
  }
})

test('calling mirror is idempotent', t => {
  const r = new Replicator(t)
  const drive1 = create()
  var drive2 = null

  drive1.ready(err => {
    t.error(err, 'no error')
    drive2 = create(drive1.key)
    drive2.ready(err => {
      t.error(err, 'no error')
      r.replicate(drive1, drive2)
      onready()
    })
  })

  function onready () {
    drive1.writeFile('hello', 'world', () => {
      drive1.writeFile('hello', 'world2', () => {
        drive1.writeFile('hello', 'world3', () => {
          drive2.mirror()
          drive2.mirror()
          drive2.mirror()
          setImmediate(() => {
            onmirroring()
          })
        })
      })
    })
  }

  function onmirroring () {
    drive2.getContent((err, content) => {
      t.error(err, 'no error')
      // All versions of 'hello' should have been synced.
      t.same(content.downloaded(), 3)
      t.same(drive2.listeners('content-feed').length, 1)
      t.same(drive2.listeners('metadata-feed').length, 1)
      t.end()
    })
  }
})

test('mirroring also mirrors mounts', t => {
  const r = new Replicator(t)
  const store = new Corestore(ram)
  var drive1, mount, drive2

  store.ready(() => {
    drive1 = create({ corestore: store, namespace: 'd1' })
    mount = create({ corestore: store, namespace: 'd2' })
    drive1.ready(() => {
      mount.ready(() => {
        drive2 = create(drive1.key)
        drive1.mount('b', mount.key, err => {
          t.error(err)
          drive2.ready(err => {
            t.error(err, 'no error')
            r.replicate(drive1, drive2)
            onready()
          })
        })
      })
    })
  })

  function onready () {
    mount.writeFile('hello', 'world', () => {
      mount.writeFile('hello', 'world2', () => {
        drive1.writeFile('a', '1', () => {
          drive1.writeFile('a', '2', () => {
            drive2.mirror()
            setImmediate(() => {
              onmirroring()
            })
          })
        })
      })
    })
  }

  function onmirroring () {
    drive2.getAllMounts((err, mounts) => {
      t.error(err, 'no error')
      const root = mounts.get('/')
      const bMount = mounts.get('/b')
      t.same(root.content.downloaded(), 2)
      t.same(bMount.content.downloaded(), 2)
      t.end()
    })
  }
})

test('mirroring mirrors dynamically-added mounts', t => {
  const r = new Replicator(t)
  const store = new Corestore(ram)
  var drive1, mount, drive2

  store.ready(() => {
    drive1 = create({ corestore: store, namespace: 'd1' })
    mount = create({ corestore: store, namespace: 'd2' })
    drive1.ready(() => {
      mount.ready(() => {
        drive2 = create(drive1.key)
        drive2.mirror()
        setImmediate(() => {
          drive1.mount('b', mount.key, err => {
            t.error(err)
            drive2.ready(err => {
              t.error(err, 'no error')
              r.replicate(drive1, drive2)
              onready()
            })
          })
        })
      })
    })
  })

  function onready () {
    mount.writeFile('hello', 'world', () => {
      mount.writeFile('hello', 'world2', () => {
        drive1.writeFile('a', '1', () => {
          drive1.writeFile('a', '2', () => {
            drive2.mirror()
            setImmediate(() => {
              onmirroring()
            })
          })
        })
      })
    })
  }

  function onmirroring () {
    drive2.getAllMounts((err, mounts) => {
      t.error(err, 'no error')
      const root = mounts.get('/')
      const bMount = mounts.get('/b')
      t.same(root.content.downloaded(), 2)
      t.same(bMount.content.downloaded(), 2)
      t.end()
    })
  }
})

test('last unmirror will clean up if mirror is called many times', t => {
  const r = new Replicator(t)
  const drive1 = create()
  var drive2 = null
  var unmirror = null
  var initialCount = null

  drive1.ready(err => {
    t.error(err, 'no error')
    drive2 = create(drive1.key)
    drive2.ready(err => {
      t.error(err, 'no error')
      r.replicate(drive1, drive2)
      initialCount = drive2.listenerCount('metadata-feed')
      onready()
    })
  })

  function onready () {
    drive1.writeFile('hello', 'world', () => {
      drive1.writeFile('hello', 'world2', () => {
        drive1.writeFile('hello', 'world3', () => {
          drive2.mirror()
          drive2.mirror()
          unmirror = drive2.mirror()
          const mirrorCount = drive2.listenerCount('metadata-feed')
          t.same(mirrorCount, initialCount + 1)
          setImmediate(() => {
            onmirroring()
          })
        })
      })
    })
  }

  function onmirroring () {
    drive2.getContent((err, content) => {
      t.same(content.downloaded(), 3)
      unmirror()
      t.same(drive2.listenerCount('metadata-feed'), initialCount)
      t.end()
    })
  }
})

function printHandle (handle) {
  handle.on('start', (...args) => console.log('start', args))
  handle.on('progress', (...args) => console.log('progress', args))
  handle.on('error', (...args) => console.log('error', args))
  handle.on('finish', (...args) => console.log('finish', args))
}
