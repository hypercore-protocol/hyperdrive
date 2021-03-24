const raf = require('random-access-file')
const Corestore = require('corestore')

module.exports = function defaultCorestore (storage, opts, drive) {
  if (isCorestore(storage)) return storage
  if (typeof storage === 'function') {
    var factory = path => storage(path, opts, drive)
  } else if (typeof storage === 'string') {
    factory = path => raf(storage + '/' + path, opts, drive)
  }
  return new Corestore(factory, opts)
}

function isCorestore (storage) {
  return storage.default && storage.get && storage.replicate && storage.close
}
