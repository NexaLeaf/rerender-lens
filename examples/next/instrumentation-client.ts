// Runs in the browser before the app's client code (Next.js 15.3+). One import starts rerender-lens
// with every memo / PureComponent tracked; NEXT_PUBLIC_RERENDER_LENS_RELAY (see .env.development)
// points it at the panel started with `npx rerender-lens panel`.
import 'rerender-lens/setup';
