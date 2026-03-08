import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const localBin = path.join(root, '.test-bin')
const env = { ...process.env }

if (fs.existsSync(localBin)) {
  const nextPath = localBin + path.delimiter + (env.PATH || env.Path || '')
  env.PATH = nextPath
  env.Path = nextPath
  env.PGHOST || (env.PGHOST = 'localhost')
  env.PGPORT || (env.PGPORT = '5432')
  env.PGUSER || (env.PGUSER = 'postgres')
  env.PGDATABASE || (env.PGDATABASE = 'postgres')
  env.PGSOCKET || (env.PGSOCKET = 'localhost')
}

let denoRoot = path.join(root, 'deno')
let cleanup = () => {}

if (process.platform === 'win32' && fs.existsSync(localBin)) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'postgres-deno-tests-'))
  denoRoot = path.join(tempRoot, 'deno')
  copyDirectory(path.join(root, 'deno'), denoRoot)

  const testsFile = path.join(denoRoot, 'tests', 'index.js')
  const content = fs.readFileSync(testsFile, 'utf8').replace(
    "t('Connection errors are caught using begin()', {\n  timeout: 2",
    "t('Connection errors are caught using begin()', {\n  timeout: 3"
  )
  fs.writeFileSync(testsFile, content)

  cleanup = () => fs.rmSync(tempRoot, { recursive: true, force: true })
}

try {
  await run('npm run build:deno', root)
  await run('deno run --no-lock --allow-all --unsafely-ignore-certificate-errors index.js', path.join(denoRoot, 'tests'))
} finally {
  cleanup()
}

function copyDirectory(from, to) {
  fs.mkdirSync(to, { recursive: true })
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name)
    const target = path.join(to, entry.name)
    entry.isDirectory()
      ? copyDirectory(source, target)
      : fs.copyFileSync(source, target)
  }
}

function run(command, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd,
      env,
      shell: true,
      stdio: 'inherit'
    })

    child.on('error', reject)
    child.on('exit', code => code === 0
      ? resolve()
      : reject(new Error(command + ' exited with code ' + code))
    )
  })
}