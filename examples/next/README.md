# rerender-lens with Next.js

The package's "any app, no extension, no Vite" path, end to end:

- `instrumentation-client.ts` imports `rerender-lens/setup`, which starts the library before the
  app's client code with every `memo` / `PureComponent` tracked.
- `.env.development` sets `NEXT_PUBLIC_RERENDER_LENS_RELAY`, so reports also go to the relay
  started with `npx rerender-lens panel --port 4142`; open the URL it prints to see the panel.

```sh
npm install && npm run build            # in the repo root: the example links the package
npm --prefix examples/next install
npx rerender-lens panel --port 4142     # terminal 1: the panel at http://127.0.0.1:4142/
npm --prefix examples/next run dev      # terminal 2: the app at http://localhost:3005/
```

`npm run e2e:next` (repo root) runs both and checks the panel connects, shows the avoidable
re-renders after a click, and highlights a component in the app from the panel.
