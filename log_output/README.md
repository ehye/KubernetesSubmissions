# Log output

A TypeScript Node.js application that generates a UUID once at startup, keeps it
in memory, and prints it with a UTC ISO timestamp immediately and every five
seconds thereafter. Restarting the process generates a new UUID.

### Requirements

- Node.js **26.13.0** (also pinned in `.node-version`)
- pnpm **12.16.1** (pinned in `package.json`)

These are the latest stable versions at implementation time. TypeScript and Node
types are pinned, and `pnpm-lock.yaml` makes dependency installation reproducible.

If pnpm is not installed, install the pinned version:

```sh
npm install --global pnpm@12.16.1
```

### Run

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

For development with automatic restart on source changes:

```sh
pnpm dev
```

Example output:

```text
2020-03-30T12:15:17.705Z: 8523ecb1-c716-4cb6-a044-b9e83bb98e43
2020-03-30T12:15:22.705Z: 8523ecb1-c716-4cb6-a044-b9e83bb98e43
```

Timer intervals are approximate and can be delayed by the event loop.

### Test

```sh
pnpm test
```

Tests verify the output format, five-second interval, stable UUID during a run,
new UUID after restart, and clean shutdown on `SIGINT` and `SIGTERM`.

### Future k3d deployment

The application writes to stdout, requires no ports or persistent storage, and
handles `SIGTERM` by clearing its timer and exiting naturally. Each container or
replica generates its own UUID. A future container can run the compiled output
directly with `node dist/index.js`; there are no runtime package dependencies.
Container and Kubernetes manifests are not included yet.
