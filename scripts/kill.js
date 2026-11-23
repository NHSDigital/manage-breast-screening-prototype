// scripts/kill.js
//
// Stops any copies of this prototype left running, such as a server that
// survived Ctrl+C or a test server from a crashed run. Only processes started
// from this folder are stopped, and only if they are the app, npm start,
// nodemon or esbuild, so editors and other tools running here are left alone.
//
// Usage: npm run kill

const { execFileSync } = require('child_process')
const path = require('path')

const projectPath = path.resolve(__dirname, '..')
const nodeModulesPath = path.join(projectPath, 'node_modules')
const appPath = path.join(projectPath, 'app.js')

// How long to wait for processes to stop before forcing them
const GRACE_PERIOD_MS = 2000

// Watchers the app starts, matched only when run from this repo's
// node_modules. Other tools there, such as eslint or playwright, are left alone
const WATCHER_NAMES = ['esbuild', 'nodemon']

const run = (command, args) => {
  try {
    return execFileSync(command, args, { encoding: 'utf8' })
  } catch (error) {
    // lsof exits with 1 when it finds nothing
    if (error.status === 1) return error.stdout || ''
    throw new Error(
      `Could not run ${command}, which npm run kill needs (macOS and Linux only)`,
      { cause: error }
    )
  }
}

const getProcesses = () =>
  run('ps', ['-Ao', 'pid=,ppid=,command='])
    .split('\n')
    .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/))
    .filter(Boolean)
    .map(([, pid, parentPid, command]) => ({
      pid: Number(pid),
      parentPid: Number(parentPid),
      command
    }))

// The working folder of each process, from lsof's field output (p = pid,
// n = path)
const getWorkingFolders = (pids) => {
  const workingFolders = new Map()
  if (!pids.length) return workingFolders

  let currentPid = null
  const output = run('lsof', ['-a', '-d', 'cwd', '-p', pids.join(','), '-Fpn'])
  for (const line of output.split('\n')) {
    if (line.startsWith('p')) {
      currentPid = Number(line.slice(1))
    } else if (line.startsWith('n') && currentPid) {
      workingFolders.set(currentPid, line.slice(1))
    }
  }
  return workingFolders
}

const isWatcher = (file = '') =>
  file.startsWith(nodeModulesPath) &&
  file.split(path.sep).some((part) => WATCHER_NAMES.includes(part))

const isPrototypeCommand = (command) => {
  const [program, ...args] = command.split(/\s+/)
  const programName = path.basename(program)

  if (isWatcher(program)) return true
  if (programName === 'npm') return args[0] === 'start'
  if (programName !== 'node') return false

  const script = args.find((arg) => !arg.startsWith('-'))
  return (
    script === '.' ||
    script === 'app.js' ||
    script === appPath ||
    isWatcher(script)
  )
}

// This script and the npm and shell processes that started it
const getOwnProcessIds = (processes) => {
  const parentPids = new Map(
    processes.map((entry) => [entry.pid, entry.parentPid])
  )
  const ownPids = new Set()
  let pid = process.pid
  while (pid && !ownPids.has(pid)) {
    ownPids.add(pid)
    pid = parentPids.get(pid)
  }
  return ownPids
}

const isRunning = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const sendSignal = (pid, signal) => {
  try {
    process.kill(pid, signal)
  } catch {
    // Already stopped
  }
}

const main = async () => {
  const processes = getProcesses()
  const ownPids = getOwnProcessIds(processes)
  const candidates = processes.filter(
    (entry) => !ownPids.has(entry.pid) && isPrototypeCommand(entry.command)
  )
  const workingFolders = getWorkingFolders(
    candidates.map((candidate) => candidate.pid)
  )
  const targets = candidates.filter((candidate) => {
    const workingFolder = workingFolders.get(candidate.pid)
    return (
      workingFolder === projectPath ||
      workingFolder?.startsWith(`${projectPath}${path.sep}`)
    )
  })

  if (!targets.length) {
    console.log('No prototype processes running')
    return
  }

  for (const target of targets) {
    console.log(`Stopping ${target.pid}: ${target.command}`)
    sendSignal(target.pid, 'SIGTERM')
  }

  await new Promise((resolve) => setTimeout(resolve, GRACE_PERIOD_MS))

  for (const target of targets.filter((target) => isRunning(target.pid))) {
    console.log(`Forcing ${target.pid} to stop`)
    sendSignal(target.pid, 'SIGKILL')
  }
}

main()
