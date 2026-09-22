// scripts/mock-pacs-websocket.js
//
// A stand-in for a PACS viewer's WebSocket interface, so the WebSocket page
// of the PACS link test can be tried without a real viewer. It replies to
// JoinContext, the ShowStudy family, CloseStudy, Heartbeat and LeaveContext
// in the shapes the viewer uses, and a few seconds after a client joins it
// pushes a ShowStudyWithPID of its own, as a viewer does when a study is
// opened from its worklist.
//
// Run with: node scripts/mock-pacs-websocket.js [port]

const { randomUUID } = require('crypto')

let WebSocketServer
try
{
  ({ WebSocketServer } = require('ws'))
}
catch
{
  console.error('The ws package is not installed. Run npm install first.')
  process.exit(1)
}

const port = Number(process.argv[2]) || 8283
const PUSH_DELAY = 8000

const server = new WebSocketServer({ port })
console.log(`Mock PACS viewer listening on ws://localhost:${port}`)

const reply = (socket, message) => {
  socket.send(JSON.stringify(message))
  console.log('->', JSON.stringify(message))
}

server.on('connection', (socket) => {
  console.log('Client connected')
  let application = null
  let guid = null
  let pushTimer = null

  socket.on('message', (raw) => {
    console.log('<-', raw.toString())

    let message
    try
    {
      message = JSON.parse(raw)
    }
    catch
    {
      return
    }

    switch (message.command)
    {
      case 'JoinContext':
        application = message.application
        guid = randomUUID().toUpperCase()
        reply(socket, {
          command: 'JoinContextReply',
          application,
          GUID: guid,
          outcome: 'accepted',
          outcomeCode: '3'
        })
        pushTimer = setTimeout(() => {
          reply(socket, {
            command: 'ShowStudyWithPID',
            contextChangeRequestor: 'vuePACS',
            accessionNumber: 'MOCK0001',
            studyInstanceUID: '1.2.826.0.1.3680043.8.1055.1.20260922.1',
            patientID: '9990000002',
            issuerOfPatientID: 'NHS',
            loadAnonymized: 'false'
          })
        }, PUSH_DELAY)
        break

      case 'ShowStudy':
      case 'ShowStudyWithPID':
      case 'ShowStudyWithLastPresentation':
        reply(socket, {
          command: 'ShowStudyReply',
          contextChangeRequestor: application,
          accessionNumber: message.accessionNumber || '',
          studyInstanceUID: message.studyInstanceUID || '1.2.826.0.1.3680043.8.1055.1.20260922.2',
          patientID: message.patientID || '9990000001',
          issuerOfPatientID: message.issuerOfPatientID || 'NHS',
          loadAnonymized: message.loadAnonymized || 'false',
          outcome: 'The study for the requested accession number has been successfully loaded.',
          outcomeCode: '0'
        })
        break

      case 'CloseStudy':
        reply(socket, {
          command: 'CloseStudyReply',
          contextChangeRequestor: application,
          accessionNumber: message.accessionNumber || '',
          patientID: '9990000001',
          issuerOfPatientID: 'NHS',
          outcome: 'The study has been successfully closed.',
          outcomeCode: '0'
        })
        break

      case 'Heartbeat': {
        const ageSeconds = Math.floor(Date.now() / 1000) - Number(message.time)
        reply(socket, {
          command: 'HeartbeatReply',
          application,
          GUID: guid,
          time: String(Math.floor(Date.now() / 1000)),
          outcome: ageSeconds <= 10 ? 'accepted' : 'rejected'
        })
        break
      }

      case 'LeaveContext':
        reply(socket, {
          notificationType: 'LeaveContextNotification',
          sendingApplication: 'VuePacs',
          notificationContent: 'Application will now leave the context'
        })
        break

      default:
        reply(socket, {
          notificationType: 'Unknown',
          sendingApplication: 'MockPacs',
          notificationContent: `Unrecognised command ${message.command}`
        })
    }
  })

  socket.on('close', () => {
    clearTimeout(pushTimer)
    console.log('Client disconnected')
  })
})
