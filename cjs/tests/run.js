const { existsSync } = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const { fileURLToPath } = require('url')

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const command = process.argv.slice(2).join(' ')

if (!command)
  throw new Error('Missing command to run')

const env = { ...process.env }
const localBin = path.join(root, '.test-bin')

if (existsSync(localBin)) {
  const nextPath = localBin + path.delimiter + (env.PATH || env.Path || '')
  env.PATH = nextPath
  env.Path = nextPath
  env.PGHOST || (env.PGHOST = 'localhost')
  env.PGPORT || (env.PGPORT = '5432')
  env.PGUSER || (env.PGUSER = 'postgres')
  env.PGDATABASE || (env.PGDATABASE = 'postgres')
  env.PGSOCKET || (env.PGSOCKET = 'localhost')
}

const child = spawn(command, {
  cwd: root,
  env,
  shell: true,
  stdio: 'inherit'
})

child.on('exit', code => process.exit(code ?? 1))
child.on('error', error => {
  console.error(error)
  process.exit(1)
})