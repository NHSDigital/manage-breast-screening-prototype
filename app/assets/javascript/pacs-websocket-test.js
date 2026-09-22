// app/assets/javascript/pacs-websocket-test.js
// Drives a PACS viewer over the WebSocket interface it exposes on the
// workstation. The page provides the connection settings and participants
// as data attributes; this module sends the JSON commands, keeps the
// heartbeat going, and logs every message in both directions.

const CYCLE_DELAY = 5000
const LEAVE_GRACE = 500

const OUTCOME_CODES = {
  0: 'success',
  1: 'error',
  2: 'study not available in the viewer',
  3: 'accepted',
  4: 'rejected'
}

class PacsWebSocketTest {
  constructor(container) {
    this.container = container
    this.url = container.dataset.url
    this.application = container.dataset.application
    this.issuer = container.dataset.issuer
    this.heartbeatSeconds = Number(container.dataset.heartbeatSeconds) || 30
    this.anonymised = container.dataset.anonymised === 'true'

    this.status = container.querySelector('[data-pacs-status]')
    this.log = document.getElementById('pacs-event-log')
    this.studies = Array.from(document.querySelectorAll('#pacs-studies [data-label]')).map((item) => ({
      label: item.dataset.label,
      accessionNumber: item.dataset.accessionNumber,
      patientId: item.dataset.patientId
    }))

    this.socket = null
    this.guid = null
    this.heartbeatTimer = null
    this.cycleTimers = []

    this.init()
  }

  init() {
    document.querySelectorAll('[data-pacs-connection], [data-pacs-study-buttons], [data-pacs-cycle], [data-pacs-log-controls]').forEach((element) => {
      element.removeAttribute('hidden')
    })

    document.querySelector('[data-pacs-clear-log]').addEventListener('click', () => this.log.replaceChildren())

    document.querySelectorAll('[data-pacs-command]').forEach((button) => {
      button.addEventListener('click', () => this.handleCommand(button))
    })

    window.addEventListener('beforeunload', () => this.disconnect({ quietly: true }))

    this.setStatus('Not connected')
    this.record(`Ready with ${this.studies.length} participant(s). WebSocket URL ${this.url}`)
  }

  handleCommand(button) {
    const command = button.dataset.pacsCommand

    switch (command)
    {
      case 'connect':
        this.connect()
        break
      case 'disconnect':
        this.disconnect()
        break
      case 'heartbeat':
        this.sendHeartbeat()
        break
      case 'cycle':
        this.cycle()
        break
      case 'cancel':
        this.cancelCycle()
        break
      default: {
        const item = button.closest('[data-label]')
        this.sendStudyCommand(command, {
          label: item.dataset.label,
          accessionNumber: item.dataset.accessionNumber,
          patientId: item.dataset.patientId
        })
      }
    }
  }

  // Connection

  connect() {
    if (this.socket)
    {
      this.record('Already connected')
      return
    }

    this.record(`Connecting to ${this.url}`)
    this.setStatus('Connecting')

    try
    {
      this.socket = new WebSocket(this.url)
    }
    catch (error)
    {
      this.record(`Could not open a WebSocket: ${error.message}`)
      this.setStatus('Not connected')
      this.socket = null
      return
    }

    this.socket.addEventListener('open', () => {
      this.record('Socket open')
      this.setStatus('Connected, joining context')
      this.send({
        command: 'JoinContext',
        application: this.application
      })
    })

    this.socket.addEventListener('message', (event) => this.receive(event.data))

    this.socket.addEventListener('error', () => {
      // The browser gives no detail for security reasons; the close event follows
      this.record('Socket error (the browser hides the reason; check the viewer is running, the port, and whether this page may reach ws://localhost)')
    })

    this.socket.addEventListener('close', (event) => {
      this.record(`Socket closed (code ${event.code}${event.reason ? `, ${event.reason}` : ''})`)
      this.stopHeartbeat()
      this.cancelCycle()
      this.socket = null
      this.guid = null
      this.setStatus('Not connected')
    })
  }

  disconnect({ quietly = false } = {}) {
    if (!this.socket)
    {
      if (!quietly)
      {
        this.record('Not connected')
      }
      return
    }

    this.stopHeartbeat()

    if (!this.guid)
    {
      this.socket.close(1000, 'Leaving')
      return
    }

    this.send({
      command: 'LeaveContext',
      application: this.requestor()
    })
    // Give the viewer's LeaveContextNotification time to arrive and be logged
    setTimeout(() => {
      if (this.socket)
      {
        this.socket.close(1000, 'Leaving')
      }
    }, LEAVE_GRACE)
  }

  // Sending

  requestor() {
    return `${this.application};${this.guid}`
  }

  send(message) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN)
    {
      this.record(`Not connected, cannot send ${message.command}`)
      return false
    }
    this.socket.send(JSON.stringify(message))
    this.record(`Sent ${message.command}: ${JSON.stringify(message)}`)
    return true
  }

  sendStudyCommand(command, study) {
    if (!this.guid)
    {
      this.record(`Join the context before sending ${command}`)
      return
    }

    const message = {
      command,
      contextChangeRequestor: this.requestor()
    }

    if (study.accessionNumber)
    {
      message.accessionNumber = study.accessionNumber
    }

    const wantsPatientId = command === 'ShowStudyWithPID' || command === 'ShowStudyWithLastPresentation'
    if (wantsPatientId && study.patientId)
    {
      message.patientID = study.patientId
      message.issuerOfPatientID = this.issuer
    }

    if (command !== 'CloseStudy')
    {
      message.loadAnonymized = String(this.anonymised)
    }

    this.record(`${command} for ${study.label}`)
    this.send(message)
  }

  sendHeartbeat() {
    if (!this.guid)
    {
      this.record('Join the context before sending a heartbeat')
      return
    }
    this.send({
      command: 'Heartbeat',
      sendingApplication: this.requestor(),
      time: String(Math.floor(Date.now() / 1000))
    })
  }

  startHeartbeat() {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), this.heartbeatSeconds * 1000)
    this.record(`Heartbeat every ${this.heartbeatSeconds}s`)
  }

  stopHeartbeat() {
    if (this.heartbeatTimer)
    {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  // Cycling: show each study in turn, closing the previous one first

  cycle() {
    if (!this.guid)
    {
      this.record('Join the context before cycling')
      return
    }
    this.cancelCycle()

    this.studies.forEach((study, position) => {
      const timer = setTimeout(() => {
        const previous = this.studies[position - 1]
        if (previous)
        {
          this.sendStudyCommand('CloseStudy', previous)
        }
        this.sendStudyCommand('ShowStudy', study)
      }, CYCLE_DELAY * position)
      this.cycleTimers.push(timer)
    })

    this.record(`Cycling through ${this.studies.length} participant(s), ${CYCLE_DELAY / 1000}s apart`)
  }

  cancelCycle() {
    if (this.cycleTimers.length === 0)
    {
      return
    }
    this.cycleTimers.forEach((timer) => clearTimeout(timer))
    this.cycleTimers = []
    this.record('Cycle cancelled')
  }

  // Receiving

  receive(raw) {
    let message
    try
    {
      message = JSON.parse(raw)
    }
    catch
    {
      this.record(`Received something that is not JSON: ${raw}`)
      return
    }

    const command = message.command || message.notificationType || 'unknown'
    this.record(`Received ${command}: ${raw}`)

    if (message.outcomeCode !== undefined)
    {
      const meaning = OUTCOME_CODES[message.outcomeCode] || 'unknown code'
      this.record(`Outcome ${message.outcomeCode} (${meaning})${message.outcome ? `: ${message.outcome}` : ''}`)
    }

    // The viewer's command names vary in case between messages
    switch (command.toLowerCase())
    {
      case 'joincontextreply':
        if (message.GUID)
        {
          this.guid = message.GUID
          this.setStatus(`Joined as ${this.application}, GUID ${this.guid}`)
          this.startHeartbeat()
        }
        else
        {
          this.setStatus('Join refused')
        }
        break
      case 'outofcontextnotification':
      case 'leavecontextnotification':
        this.guid = null
        this.stopHeartbeat()
        this.setStatus('Connected, not in context')
        break
      default:
        break
    }
  }

  // Page

  setStatus(text) {
    this.status.textContent = text
  }

  record(message) {
    const item = document.createElement('li')
    const time = new Date().toLocaleTimeString('en-GB', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3
    })
    item.textContent = `${time} ${message}`
    this.log.appendChild(item)
    console.log(`[PACS WebSocket test] ${message}`)
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('pacs-websocket')
  if (container)
  {
    new PacsWebSocketTest(container)
  }
})
