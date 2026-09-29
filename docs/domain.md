# Domain model and business context

What the breast screening service does: the healthcare domain, business processes, user roles and clinical workflows. Read this before working on views, content or anything that touches screening concepts.

For how the prototype is built, see [.github/copilot-instructions.md](../.github/copilot-instructions.md) and the other docs in this folder.

## Service purpose

Run breast screening in England (Rubie) is a new NHS service for clinical and clerical staff (receptionists, mammographers, radiographers) to manage and triage women coming in for breast screening, from when they arrive at a hospital or screening van, through having a mammogram, to getting results. The service covers the journey up to diagnosis, not clinical treatment. Where mammograms may show an abnormality, the service will manage further tests. It is not medical software: it supports the clerical data collection side.

## Domain model

### Initial screening

- Breast screening units (BSUs, also known as BSOs for breast screening offices) are the organisations where breast screening takes place.
- Each BSU runs clinics, either at its main location or in mobile vans.
- Women aged 50 to 70 (participants) are invited for screening every 3 years. Depending on risk level, other ages and intervals apply.
- Each screening round is an episode. It lasts from invitation until a result, or until the episode is closed for another reason.
- Each participant has a unique SX number (BSU abbreviation plus 6 digits) as well as an NHS number. There is an aim to move away from SX numbers and use NHS numbers universally.
- Participants attend clinics for screening appointments.
- Clinics run with short appointment slots, often double-booked. Slots can be longer for some participants.
- A typical target is about 60 bookings expecting 40 attendances.
- Commonly four x-rays (views) are taken, two per breast: craniocaudal (CC) and mediolateral oblique (MLO), so LCC, LMLO, RCC and RMLO. Extra views may be taken if the participant has large breasts or there is a technical problem.

### Image reading

After mammograms are taken, the episode moves to image reading. Radiologists (image readers) look at the images and decide they are normal, need further assessment, or need retaking (technical recall). Each case is read twice by two different readers, the first read and the second read, usually blind. If the two reads agree (concordant) the result stands. If they disagree (discordant) the case goes to arbitration.

Some units arbitrate all recalls, not just discordant cases. Arbitration is done either by a third reader (in effect a third read) or by a panel of several readers. If the outcome is normal, the participant gets their result and returns in 3 years. If not, they are brought back for assessment and further tests.

Assessment will be part of the service but has not been designed yet.

## Good to know

Many things in breast screening are recorded as left and right: symptoms, observations, mammogram data. When displaying or capturing this data, the right breast goes on the left of the page and the left breast on the right. This is a standard in breast screening and matches the position when facing the patient.

## Key entities

### Breast screening units (BSUs)

Fixed organisational data:

- Name, address, phone, abbreviation (for example OXF)
- Can run several clinics per day (hospital plus mobile locations)

### Participants

The women being screened:

- Demographic information (name, date of birth, contact details)
- Long-term medical information (NHS number, risk factors, history)
- A unique SX number

### Clinics

A scheduled session for screening appointments:

- Date and location
- Type (hospital-based or mobile van)
- A set of appointment slots
- Linked to a BSU
- Target of about 60 bookings expecting 40 attendances, often double-booked

### Episodes

One screening round for a participant, and the container that round's appointments sit in:

- Links a participant to their appointments for the round (every appointment has an `episodeId`)
- While open, its stage says how far the round has got: scheduled, mammograms, reading, assessment
- When it closes it takes an outcome: routine recall, refer for treatment, or no result
- Carries a summary of the images the round produced, plus reading and priors state
- Keeps a stage history with timestamps

See [data-conventions.md](data-conventions.md) for how episodes behave in the data.

### Appointments

A participant's visit to a clinic, within a screening episode:

- Links a participant to a clinic appointment slot
- Tracks status through the visit: scheduled, checked in, in progress, complete. Other outcomes are partially screened, did not attend, attended not screened, cancelled and rescheduled
- Records attendance and outcomes
- Captures medical data during the visit (symptoms, observations, mammogram data)
- Keeps a status history with timestamps
- Future appointment types will be technical recall and assessment

## User workflows

The application supports the day-to-day running of clinics:

1. **Viewing clinics**: all clinics or today's clinics
2. **Managing participants**: within a clinic context
3. **Tracking the journey**: participant status through their screening appointment
4. **Recording information**: participant demographics and medical data
5. **Reading images**: mammogram review and results

## Image reading workflow

After screening appointments, mammograms are reviewed by radiologists. This is a critical quality assurance step.

### Reading process

1. **First read**: initial assessment by a radiologist
2. **Second read**: independent review by a different radiologist, blind to the first reader's assessment
3. **Arbitration**: if the two reads disagree, a third radiologist or a panel resolves it

### Reading outcomes

- **Normal**: no issues, participant returns for routine screening in 3 years
- **Technical recall**: images need retaking for technical or quality reasons
- **Recall for assessment**: potential abnormality, participant recalled for further tests
- **Request priors**: pause reading while earlier images from another location are retrieved
- **Defer** (also "raise an exception"): postpone reading a case where something is wrong, such as the wrong images

### Quality requirements

- Each case needs two independent reads by different radiologists
- Second readers cannot see the first reader's assessment
- Disagreements trigger arbitration
- Cases with participant symptoms need special handling

### Reading organisation

- Reading queues organised by clinic
- Radiologists can skip cases and return to them later
- The system tracks reading progress and completion
- Cases needing arbitration are identified and flagged

For the technical side of reading, see [image-reading.md](image-reading.md).
