const test = require('tape')
const crypto = require('crypto')
const create = require('./helpers/create')

const fixtures = [
  'a/a',
  'a/b',
  'a/c/d',
  'a/c/e',
  'a/e',
  'b/e',
  'b/f',
  'b/d',
  'f/a',
  'e'
]

test('a non empty directory can not be removed', async function (t) {
  const drive = create()
  const files = createFiles(fixtures)

  await writeFiles(drive, files)

  try {
    await drive.promises.rmdir('f')
  } catch (err) {
    t.ok(err)
  }

  t.end()
})

test('an empty directory can be removed', async function (t) {
  const drive = create()
  const files = createFiles(fixtures)

  await writeFiles(drive, files)
  await drive.promises.mkdir('fff')

  const fileListA = await drive.promises.readdir('/')

  await drive.promises.rmdir('fff')

  const fileListB = await drive.promises.readdir('/')

  t.equal(fileListB.length, fileListA.length - 1)
  t.end()
})

test('a directory can be recursively removed', async function (t) {
  const drive = create()

  const files = createFiles(fixtures)

  await writeFiles(drive, files)

  const fileListA = await drive.promises.readdir('/', { recursive: true })

  await drive.promises.rmdir('/a', { recursive: true })

  const fileListB = await drive.promises.readdir('/', { recursive: true })

  t.equal(fileListA.length, 10)
  t.deepEqual(fileListB, [ 'b/e', 'b/d', 'b/f', 'e', 'f/a' ])
  t.end()
})

function createFiles (names) {
  const files = []
  for (const name of names) {
    files.push([name, crypto.randomBytes(32)])
  }
  return new Map(files)
}

function writeFiles (drive, files) {
  return new Promise((resolve, reject) => {
    let expected = files.size

    for (const [name, contents] of files) {
      drive.writeFile(name, contents, err => {
        if (err) return reject(err)
        if (!--expected) return resolve(null)
      })
    }
  })
}
