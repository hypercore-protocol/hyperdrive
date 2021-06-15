const mutexify = require('mutexify')

const CONTENT_LOCK = Symbol('HyperdriveContentLock')

function contentOptions (self) {
  return {
    sparse: self.sparse || self.latest,
    maxRequests: self.maxRequests,
    storageCacheSize: self.contentStorageCacheSize,
    ...self.contentOpts
  }
}

class ContentState {
  constructor (feed) {
    this.feed = (feed instanceof ContentState) ? feed.feed : feed
    if (!this.feed[CONTENT_LOCK]) this.feed[CONTENT_LOCK] = mutexify()
  }
  lock (cb) {
    return this.feed[CONTENT_LOCK](cb)
  }
  isLocked () {
    return this.feed[CONTENT_LOCK].locked
  }
}

module.exports = {
  contentOptions,
  ContentState
}
