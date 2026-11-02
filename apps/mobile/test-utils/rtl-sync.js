/**
 * Synchronous-render shim over `@testing-library/react-native` for the pinned toolchain
 * (RTL-RN 14.1.0 + React 19). Jest remaps `@testing-library/react-native` to this module
 * (see `jest.config.js` `moduleNameMapper`), so every test transparently gets a `render`
 * whose initial mount is committed synchronously — matching the v13 (React 18) behaviour
 * the component contracts were written against.
 *
 * RTL 14.x's own `render` is declared `async` purely to `await act(...)` around the mount.
 * The underlying test renderer commits the initial mount synchronously inside that `act`
 * callback, so the `await` only matters for concurrent/suspense features we do not use
 * here. This shim performs the exact same steps as the upstream `render` (same renderer
 * options, same query binding, same `screen` wiring, same cleanup registration) but drives
 * React's `act` synchronously, so `render(...)` returns the fully-mounted result object and
 * `screen` is populated the instant it returns. Everything else is re-exported untouched;
 * no production code or component behaviour is affected.
 */
/* eslint-disable @typescript-eslint/no-var-requires */
const React = require('react');
const real = require('@testing-library/react-native/dist/index.js');
const { createRoot } = require('test-renderer');
const {
  HOST_TEXT_NAMES,
} = require('@testing-library/react-native/dist/helpers/host-component-names.js');
const { getQueriesForInstance } = require('@testing-library/react-native/dist/within.js');
const { setRenderResult } = require('@testing-library/react-native/dist/screen.js');
const { addToCleanupQueue } = require('@testing-library/react-native/dist/cleanup.js');
// Internal helpers RTL's own `fireEvent` composes — reused so the shim's synchronous
// `fireEvent` dispatches events identically, only driving `act` synchronously.
const {
  isInstanceMounted,
} = require('@testing-library/react-native/dist/helpers/component-tree.js');
const {
  isHostScrollView,
} = require('@testing-library/react-native/dist/helpers/host-component-names.js');
const { mergeEventProps } = require('@testing-library/react-native/dist/events/builders/merge.js');
const { buildTouchEvent } = require('@testing-library/react-native/dist/events/builders/common.js');
const {
  buildScrollEvent,
} = require('@testing-library/react-native/dist/events/builders/scroll.js');
const {
  buildLayoutEvent,
} = require('@testing-library/react-native/dist/events/builders/common.js');
const { normalizeEventType } = require('@testing-library/react-native/dist/events/handler.js');
const { nativeState } = require('@testing-library/react-native/dist/events/native-state.js');
const { findEventHandler } = require('@testing-library/react-native/dist/events/propagation.js');
const {
  updateNativeStateFromEvent,
} = require('@testing-library/react-native/dist/events/update-native-state.js');
const {
  warnAboutUnhandledEvent,
} = require('@testing-library/react-native/dist/events/warnings.js');

function withHiddenStyle(style) {
  if (style == null) {
    return { display: 'none' };
  }
  return [style, { display: 'none' }];
}

function render(element, options = {}) {
  const { wrapper: Wrapper } = options || {};
  const rendererOptions = {
    textComponentTypes: HOST_TEXT_NAMES,
    publicTextComponentTypes: ['Text'],
    transformHiddenInstanceProps: ({ props }) => ({
      ...props,
      style: withHiddenStyle(props.style),
    }),
  };
  const wrap = (el) => (Wrapper ? React.createElement(Wrapper, null, el) : el);
  const renderer = createRoot(rendererOptions);

  // Synchronous act: the test renderer commits the initial mount before this returns.
  React.act(() => {
    renderer.render(wrap(element));
  });

  const container = renderer.container;
  const rerender = (component) => {
    React.act(() => {
      renderer.render(wrap(component));
    });
  };
  const unmount = async () => {
    await real.act(async () => {
      renderer.unmount();
    });
  };
  const toJSON = () => {
    const json = renderer.container.toJSON();
    if (json?.children.length === 0) {
      return null;
    }
    if (json?.children.length === 1 && typeof json.children[0] !== 'string') {
      return json.children[0];
    }
    return json;
  };

  addToCleanupQueue(unmount);

  const result = {
    ...getQueriesForInstance(container),
    rerender,
    unmount,
    toJSON,
    debug: () => undefined,
    get container() {
      return renderer.container;
    },
    get root() {
      const firstChild = container.children[0];
      if (typeof firstChild === 'string') {
        throw new Error('Invariant Violation: Root element must be a host element.');
      }
      return firstChild;
    },
  };

  setRenderResult(result);
  return result;
}

/**
 * Synchronous `fireEvent`, matching the shim's sync-render contract.
 *
 * RTL-RN 14.x made `fireEvent` (and `fireEvent.changeText`/`.press`/…) `async`: each call
 * `await`s an internal `act(...)` that is ALWAYS async (see `dist/act.js`). The component
 * contracts here were written against the v13 (React 18) behaviour where `fireEvent` is
 * synchronous, so a test can fire several events in a row WITHOUT awaiting each (e.g.
 * `fireEvent.changeText(email); fireEvent.changeText(password)`). Under the async v14
 * `fireEvent` those un-awaited calls open overlapping async `act` scopes, leaving React's
 * module-level act queue dangling — which then corrupts the NEXT test's synchronous mount
 * (an empty tree / "overlapping act() calls").
 *
 * This shim dispatches the exact same event (same target resolution, propagation, and
 * native-state update as RTL's own `fireEventInternal`) but drives the handler through a
 * SYNCHRONOUS `React.act`, so each call commits before it returns and nothing is left
 * pending. Behaviour is identical to the v13 synchronous `fireEvent`; test infra only, no
 * production behaviour is affected.
 */
function fireEventInternalSync(instance, options) {
  const { type, data, bubbles } = options;
  if (!isInstanceMounted(instance)) {
    return undefined;
  }
  const hasUpdatedNativeState = updateNativeStateFromEvent(
    instance,
    normalizeEventType(type),
    data[0],
  );
  const { handler, skippedTargets } = findEventHandler(instance, type, { bubbles });
  if (!handler) {
    warnAboutUnhandledEvent(instance, type, { skippedTargets, hasUpdatedNativeState });
    return undefined;
  }
  let returnValue;
  React.act(() => {
    returnValue = handler(...data);
  });
  return returnValue;
}

function fireEvent(instance, eventType, ...data) {
  return fireEventInternalSync(instance, { type: eventType, data, bubbles: true });
}
fireEvent.changeText = (instance, text) => fireEvent(instance, 'changeText', text);
fireEvent.press = (instance, eventProps) =>
  fireEvent(instance, 'press', mergeEventProps(buildTouchEvent(), eventProps));
fireEvent.scroll = (instance, eventProps) => {
  const layoutMeasurement = isHostScrollView(instance)
    ? nativeState.layoutSizeForInstance.get(instance)
    : undefined;
  const event = buildScrollEvent(undefined, { layoutMeasurement });
  return fireEvent(instance, 'scroll', mergeEventProps(event, eventProps));
};
fireEvent.layout = (instance, layout) =>
  fireEventInternalSync(instance, {
    type: 'layout',
    data: [buildLayoutEvent(layout)],
    bubbles: false,
  });

// Re-export the real library, but expose `screen` as a LIVE getter. RTL reassigns its
// `exports.screen` binding on every render (`setRenderResult`), so a one-time value spread
// would freeze the detached default and break every `screen.*` query. Delegating through a
// getter keeps the test reading the library's current render result. `render` + `fireEvent`
// are the synchronous shims; everything else is the real library untouched.
module.exports = {
  ...real,
  render,
  fireEvent,
};

Object.defineProperty(module.exports, 'screen', {
  configurable: true,
  enumerable: true,
  get() {
    return real.screen;
  },
});
