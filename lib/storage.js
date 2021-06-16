const raf = require('random-access-file')
const Corestore = require('corestore')
const join = require('path').join

module.exports = function defaultCorestore (storage, opts) {
  if (isCorestore(storage)) return storage
  
  switch (typeof storage) {
    case 'function': return new Corestore(path => storage(path), opts)
    case 'string': return new Corestore(path => raf(join(storage, path), opts))
    default:
      throw new Error('hyperdrive expects "storage" of type function|string, but got ' + typeof storage)
  }
}

function isCorestore (storage) {
  return storage.default && storage.get && storage.replicate && storage.close
}
