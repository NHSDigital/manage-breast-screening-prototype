# NHS Run breast screening in England (Rubie) service (prototype)

A prototype for managing breast screening, built using the [NHS.UK prototype kit](https://prototype-kit.service-manual.nhs.uk).

Designed and built by NHS England as part of the Digital transformation of screening programme.

## About this prototype

This prototype explores potential designs for a service to manage breast screening. It focuses on two key areas of the screening journey:

1. Inital screening (mammography)
2. Image reading (reviewewing mammograms)

The prototype generates realistic fake data to simulate different scenarios.

You can [read our design histories](https://design-history.prevention-services.nhs.uk/manage-breast-screening/) to understand more about how we designed this service.

## Installation

1. Follow the [NHS.UK prototype kit installation guide](https://prototype-kit.service-manual.nhs.uk/install/simple)
2. Clone this repository
3. Run `npm install`
4. Run `npm run watch`

The prototype will generate example data on first run, and from then on once per day.

## Features

- View all clinics or today's clinics
- View clinic details and participant lists
- Track participant status through their screening journey
- View participant details within clinic context

## Development notes

- Example data is auto-generated in `app/data/generated`
- You can regenerate data by visiting `/settings`
- You can also run the generator directly with `node app/lib/generate-seed-data.js`
- Uses NHS design system components and patterns
- Use `tree app` to generate a tree diagram of the project
- Documentation for the codebase, including how pages, forms, routes and data work, is in [docs/](docs/README.md). Instructions for coding assistants are in [.github/copilot-instructions.md](.github/copilot-instructions.md)

## Security

As with all prototypes made with the NHS.UK prototype kit, this is for research and testing only. Do not use with real participant data.
