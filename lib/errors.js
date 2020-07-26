const CustomError = require('custom-error-class')

class FileNotFound extends CustomError {
  constructor (fileName) {
    super(`No such file or directory: '${fileName}'.`)
    this.code = 'ENOENT'
    this.errno = 2
  }
}

class DirectoryNotEmpty extends CustomError {
  constructor (dirName) {
    super(`Directory '${dirName}' is not empty.`)
    this.code = 'ENOTEMPTY'
    this.errno = 39
  }
}

class PathAlreadyExists extends CustomError {
  constructor (dirName) {
    super(`Path ${dirName} already exists.`)
    this.code = 'EEXIST'
    this.errno = 17
  }
}

class BadFileDescriptor extends CustomError {
  constructor (msg) {
    super(msg)
    this.code = 'EBADF'
    this.errno = 9
  }
}

class InvalidArgument extends CustomError {
  constructor (msg) {
    super(msg)
    this.code = 'EINVAL'
    this.errno = 22
  }
}

class InvalidPermission extends CustomError {
  constructor (msg) {
    super(msg)
    this.code = 'EPERM'
    this.errno = 1
  }
}

class IsDirectory extends CustomError {
  constructor (dirName) {
    super(`'${dirName}' is a directory.`)
    this.code = 'EISDIR'
    this.errno = 21
  }
}

class IsNotDirectory extends CustomError {
  constructor (dirName) {
    super(`'${dirName}' is not a directory.`)
    this.code = 'ENOTDIR'
    this.errno = 20
  }
}

module.exports = {
  FileNotFound,
  DirectoryNotEmpty,
  PathAlreadyExists,
  BadFileDescriptor,
  InvalidArgument,
  InvalidPermission,
  IsDirectory,
  IsNotDirectory
}
