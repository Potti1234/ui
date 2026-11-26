import {
  Command,
  type Component,
  type Mount,
  Route,
  Router,
  UiSchema,
  View
} from "@effect/ui"
import {
  type Positioning,
  Tooltip,
  type TooltipProps,
  TooltipProvider
} from "@effect/ui-kit"
import { Html } from "@effect/ui/html"
import { HtmlScene, TestGlobalEvents } from "@effect/ui/html/testing"
import { Locator, Story, TestHost } from "@effect/ui/testing"
import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer, Schema } from "effect"
import { TestClock } from "effect/testing"

const standIn = {
  elements: Html,
  view: (
    tooltip: Component.Headless.Parts<typeof Tooltip>,
    h: View.Helper<never, TooltipProps> & View.Tags<Html.Elements, never>
  ) =>
    h.span(
      tooltip.trigger(h.button.attr("aria-label", "Bold")).children("B"),
      tooltip.positioner(h.div).children(
        tooltip.popup(h.div.class("popup")).children(
          tooltip.arrow(h.div),
          "Bold"
        )
      )
    )
}

// Stand-in for the one-element Button port until it lands.
const Button = <Msg, R>(
  h: View.Tags<Html.Elements, Msg>,
  options: {
    readonly element?: Html.Element<
      Msg,
      R,
      Html.EventsOf<"button">,
      HTMLButtonElement,
      "button"
    >
    readonly props?: { readonly disabled?: boolean }
    readonly onPress?: Msg
  }
) => {
  const element = (options.element ?? h.button).attr("type", "button").disabled(
    options.props?.disabled === true
  )
  return options.onPress === undefined
    ? element
    : element.on("click", options.onPress)
}

// A parent that opens the tooltip on a styled Button and counts what it hears.
const ToolbarMessage = UiSchema.TaggedEnum({
  PressedBold: {},
  RequestedOpenBoldTip: {},
  RequestedCloseBoldTip: {}
})

const Toolbar = Html.component({
  name: "Toolbar",
  model: Schema.Struct({
    open: Schema.Boolean,
    pressed: Schema.Number,
    dismissed: Schema.Number
  }),
  message: ToolbarMessage
}).make({
  init: () => ({ open: true, pressed: 0, dismissed: 0 }),
  update: {
    PressedBold: ($) => ({ ...$.model, pressed: $.model.pressed + 1 }),
    RequestedOpenBoldTip: ($) => ({ ...$.model, open: true }),
    RequestedCloseBoldTip: ($) => ({
      ...$.model,
      open: false,
      dismissed: $.model.dismissed + 1
    })
  },
  view: (h, model) =>
    h.div(
      Tooltip(h, {
        key: "bold",
        props: { open: model.open },
        onEmit: (event) =>
          event._tag === "RequestedOpen"
            ? ToolbarMessage.RequestedOpenBoldTip()
            : ToolbarMessage.RequestedCloseBoldTip(),
        view: (tooltip) =>
          h.span(
            Button(h, {
              element: tooltip.trigger(h.button),
              onPress: ToolbarMessage.PressedBold()
            }).class("tool").attr("aria-label", "Bold").children("B"),
            tooltip.positioner(h.div).children("Bold")
          )
      }),
      h.output(`pressed ${model.pressed}, dismissed ${model.dismissed}`)
    )
})

// Two tooltips under a provider, and one Model field for which one shows.
// TestHost runs no mounts, so these tooltips' popups aren't hoverable and
// the trigger's `mouseleave` closes them.
const Tip = Schema.Literals(["bold", "italic"])
const GroupedMessage = UiSchema.TaggedEnum({
  RequestedOpenTip: { tip: Tip },
  RequestedCloseTip: { tip: Tip }
})

const Grouped = Html.component({
  name: "Grouped",
  model: Schema.Struct({ tip: Schema.NullOr(Tip) }),
  message: GroupedMessage
}).make({
  init: () => ({ tip: null }),
  update: {
    RequestedOpenTip: (_, { tip }) => ({ tip }),
    RequestedCloseTip: (
      $,
      { tip }
    ) => ($.model.tip === tip ? { tip: null } : $.model)
  },
  view: (h, model) =>
    TooltipProvider(h, {
      props: {},
      view: () =>
        h.div(
          ...Tip.literals.map((tip) =>
            Tooltip(h, {
              key: tip,
              props: { open: model.tip === tip, disableHoverablePopup: true },
              onEmit: (event) =>
                event._tag === "RequestedOpen"
                  ? GroupedMessage.RequestedOpenTip({ tip })
                  : GroupedMessage.RequestedCloseTip({ tip }),
              view: (tooltip) =>
                h.span(
                  tooltip.trigger(h.button.attr("aria-label", tip)).children(
                    tip
                  ),
                  tooltip.positioner(h.div).children(
                    tooltip.popup(h.div.class(`${tip}-popup`)).children(tip)
                  )
                )
            })
          )
        )
    })
})

const PageRoute = Route.union({
  Tips: Route.make("/"),
  Away: Route.make("/away")
})
const PagesMessage = UiSchema.TaggedEnum({
  ChangedRoute: { route: PageRoute },
  Left: {},
  Navigated: {}
})

const Pages = Html.component({
  name: "Pages",
  props: Schema.Struct({ route: PageRoute }),
  model: PageRoute,
  message: PagesMessage
}).make({
  init: ($) => $.props.route,
  update: {
    ChangedRoute: (_, { route }) => route,
    Left: ($) =>
      $.run(
        Router.push(PageRoute, PageRoute.Away()).pipe(
          Command.map(() => PagesMessage.Navigated())
        )
      ),
    Navigated: ($) => $.model
  },
  subscriptions: (
    { model: route }
  ) => [
    Router.subscription(
      PageRoute,
      route,
      (to) => PagesMessage.ChangedRoute({ route: to })
    )
  ],
  view: (h, route) =>
    h.div(
      h.a.on("click", PagesMessage.Left()).children("Away"),
      route._tag === "Tips" ? Grouped(h, { key: "tips" }) : null
    )
})

// Two tooltips under a provider, each with its own field. `keep` refuses
// bold's `RequestedClose`, and `bold` counts bold's requests to close. As
// in `Grouped`, the popups aren't hoverable.
const IndependentMessage = UiSchema.TaggedEnum({
  RequestedOpenTip: { tip: Tip },
  RequestedCloseTip: { tip: Tip }
})

const Independent = Html.component({
  name: "Independent",
  props: Schema.Struct({ keep: Schema.Boolean, closeDelay: Schema.Number }),
  model: Schema.Struct({
    bold: Schema.Boolean,
    italic: Schema.Boolean,
    requests: Schema.Number
  }),
  message: IndependentMessage
}).make({
  init: () => ({ bold: false, italic: false, requests: 0 }),
  update: {
    RequestedOpenTip: ($, { tip }) => ({ ...$.model, [tip]: true }),
    RequestedCloseTip: ($, { tip }) =>
      tip === "bold"
        ? { ...$.model, bold: $.props.keep, requests: $.model.requests + 1 }
        : { ...$.model, italic: false }
  },
  view: (h, model) =>
    h.div(
      TooltipProvider(h, {
        props: {},
        view: () =>
          h.div(
            ...Tip.literals.map((tip) =>
              Tooltip(h, {
                key: tip,
                props: {
                  open: model[tip],
                  closeDelay: tip === "bold" ? h.props.closeDelay : 0,
                  disableHoverablePopup: true
                },
                onEmit: (event) =>
                  event._tag === "RequestedOpen"
                    ? IndependentMessage.RequestedOpenTip({ tip })
                    : IndependentMessage.RequestedCloseTip({ tip }),
                view: (tooltip) =>
                  h.span(
                    tooltip.trigger(h.button.attr("aria-label", tip)).children(
                      tip
                    ),
                    tooltip.positioner(h.div).children(
                      tooltip.popup(h.div).children(tip)
                    )
                  )
              })
            )
          )
      }),
      h.output(String(model.requests))
    )
})

// Three tooltips under a provider whose opens and closes the test accepts by
// hand, with `AcceptedOpen` and `AcceptedClose`, whenever it likes. Bold's
// requests to close are counted and refused, so it stays visible. The
// others' are accepted.
const Mark = Schema.Literals(["bold", "italic", "underline"])
const DeferredMessage = UiSchema.TaggedEnum({
  RequestedOpen: { tip: Mark },
  RequestedClose: { tip: Mark },
  AcceptedOpen: { tip: Mark },
  AcceptedClose: { tip: Mark }
})

const Deferred = Html.component({
  name: "Deferred",
  model: Schema.Struct({
    bold: Schema.Boolean,
    italic: Schema.Boolean,
    underline: Schema.Boolean,
    requests: Schema.Number
  }),
  message: DeferredMessage
}).make({
  init: () => ({ bold: false, italic: false, underline: false, requests: 0 }),
  update: {
    RequestedOpen: ($) => $.model,
    RequestedClose: ($, { tip }) =>
      tip === "bold"
        ? { ...$.model, requests: $.model.requests + 1 }
        : { ...$.model, [tip]: false },
    AcceptedOpen: ($, { tip }) => ({ ...$.model, [tip]: true }),
    AcceptedClose: ($, { tip }) => ({ ...$.model, [tip]: false })
  },
  view: (h, model) =>
    h.div(
      TooltipProvider(h, {
        props: {},
        view: () =>
          h.div(
            ...Mark.literals.map((tip) =>
              Tooltip(h, {
                key: tip,
                props: { open: model[tip] },
                onEmit: (event) =>
                  event._tag === "RequestedOpen"
                    ? DeferredMessage.RequestedOpen({ tip })
                    : DeferredMessage.RequestedClose({ tip }),
                view: (tooltip) =>
                  h.span(
                    tooltip.trigger(h.button.attr("aria-label", tip)).children(
                      tip
                    ),
                    tooltip.positioner(h.div).children(
                      tooltip.popup(h.div).children(tip)
                    )
                  )
              })
            )
          )
      }),
      h.output(String(model.requests))
    )
})

const trigger = Locator.tag("button")
const positioner = Locator.attr("role", "presentation")
const h = View.makeHelper<never, {}, Html.Elements>({}, Html)

const top = {
  side: "top",
  align: "center",
  anchorHidden: false,
  arrowUncentered: false
} as const

type Track = Mount.Issued<unknown, never, never, unknown>
type Rendered = { readonly get: (locator: Locator.Locator) => Locator.Node }
// The positioner's mount, which places it and watches the hover area.
const tracking = (scene: Rendered): Track =>
  (scene.get(positioner) as unknown as View.Element<unknown>).owned?.find((
    layer
  ) => layer.mount !== undefined)
    ?.mount as unknown as Track
const sent = (tag: string, fields: object = {}) =>
  ({ _tag: tag, ...fields }) as never
const placed = (placement: Positioning.Placement = top) =>
  sent("ChangedPlacement", { placement })

const opened = (props: TooltipProps) =>
  HtmlScene.make(Tooltip, props, standIn).pipe(
    Effect.map((scene) => scene.mounted(tracking(scene), placed()))
  )

// The message a wait would have produced: the Command's own result.
const completed = (
  tag: "CompletedWaitBeforeOpening" | "CompletedWaitBeforeClosing"
) => ({ _tag: tag }) as never

describe("Tooltip", () => {
  it.effect("hover opens after the delay and stays open until the pointer leaves the hover area", () =>
    Effect.gen(function*() {
      const scene = yield* HtmlScene.make(Tooltip, { open: false }, standIn)
      scene.fire(trigger, "mouseenter")
      const [opening] = scene.current.pending
      assert.deepStrictEqual(opening?.command.args, { delay: 600 })
      scene.resolve(opening!.command, completed("CompletedWaitBeforeOpening"))
        .emitted({ _tag: "RequestedOpen" })
      assert.isFalse(scene.get(positioner).props?.popoverOpen)
      scene.props({ open: true, side: "bottom", sideOffset: 8 })
      scene.mounted(tracking(scene), placed())

      assert.isTrue(scene.get(positioner).props?.popoverOpen)
      // Each part draws the children it was given.
      assert.strictEqual(Locator.textOf(scene.get(positioner)), "Bold")

      // Leaving the trigger toward the popup doesn't close it: the
      // positioner's mount says when the pointer has left the hover area.
      scene.fire(trigger, "mouseleave")
      assert.deepStrictEqual(scene.current.pending, [])
      scene.mounted(tracking(scene), sent("LeftHoverArea"))
      scene.mounted(tracking(scene), sent("ReturnedToHoverArea"))
      assert.deepStrictEqual(scene.current.interrupted.map((c) => c.name), [
        "WaitBeforeClosing"
      ])
      // A close the consumer declines keeps the pointer in the hover area.
      scene.fireDocument("keydown", { key: "Escape" })
        .emitted({ _tag: "RequestedClose" })
      scene.mounted(tracking(scene), sent("LeftHoverArea"))
      scene.resolve(
        scene.current.pending[0]!.command,
        completed("CompletedWaitBeforeClosing")
      )
        .emitted({ _tag: "RequestedClose" })
    }))

  it.effect("the pointer the hover area last saw doesn't hold it open once disableHoverablePopup is set", () =>
    Effect.gen(function*() {
      const scene = yield* opened({ open: true })
      scene.fire(trigger, "mouseenter")
        .mounted(tracking(scene), sent("ReturnedToHoverArea"))
        .props({ open: true, disableHoverablePopup: true })
        .fire(trigger, "mouseleave")
      scene.resolve(
        scene.current.pending[0]!.command,
        completed("CompletedWaitBeforeClosing")
      )
        .emitted({ _tag: "RequestedClose" })
    }))

  it.effect("listens on the document only while it shows", () =>
    Effect.gen(function*() {
      const scene = yield* HtmlScene.make(Tooltip, { open: false }, standIn)
      assert.deepStrictEqual(scene.subscriptions, [])
      scene.props({ open: true })
      scene.mounted(tracking(scene), placed())
      assert.deepStrictEqual(scene.subscriptions, [
        `@effect/ui/html/document:"keydown"`,
        `@effect/ui/html/document:"mousedown","capture"`
      ])
    }))

  it.effect("document Escape skips another key, a composition, modified Escape and an Escape already handled", () =>
    Effect.gen(function*() {
      const scene = yield* opened({ open: true })
      scene.fireDocument("keydown", { key: "a" }).expectIgnored()
        .expectDefaultPrevented(false)
        .fireDocument("keydown", { key: "Escape", composing: true })
        .expectIgnored()
        .fireDocument("keydown", { key: "Escape", ctrl: true }).expectIgnored()
        .expectDefaultPrevented(false)
        .fireDocument("keydown", { key: "Escape", alt: true }).expectIgnored()
        .expectDefaultPrevented(false)
        .fireDocument("keydown", { key: "Escape", meta: true }).expectIgnored()
        .expectDefaultPrevented(false)
        .fireDocument("keydown", { key: "Escape", defaultPrevented: true })
        .expectIgnored()
      assert.deepStrictEqual(scene.current.emitted, [])
    }))

  it.effect("focus without a focus ring neither opens the tooltip nor holds it open", () =>
    Effect.gen(function*() {
      const scene = yield* HtmlScene.make(Tooltip, { open: false }, standIn)
      scene.fire(trigger, "focus", { focusVisible: false })
      assert.deepStrictEqual(scene.current.emitted, [])
      scene.props({ open: true })
      scene.mounted(tracking(scene), placed())
        .fire(trigger, "mouseenter")
        .fire(trigger, "mouseleave")
        .mounted(tracking(scene), sent("LeftHoverArea"))
      scene.resolve(
        scene.current.pending[0]!.command,
        completed("CompletedWaitBeforeClosing")
      )
        .emitted({ _tag: "RequestedClose" })
    }))

  it.effect("activation dismisses on click rather than mousedown unless closeOnClick is false", () =>
    Effect.gen(function*() {
      const scene = yield* opened({ open: true })
      scene.fire(trigger, "click")
        .emitted({ _tag: "RequestedClose" })
      scene.fire(trigger, "mousedown")
      assert.deepStrictEqual(scene.current.emitted, [])
      scene.props({ open: true, closeOnClick: false })
        .fire(trigger, "click")
      assert.deepStrictEqual(scene.current.emitted, [])
    }))

  it.effect("a press outside closes the tooltip at once, while focus or the close delay holds it open", () =>
    Effect.gen(function*() {
      const scene = yield* HtmlScene.make(
        Tooltip,
        { open: false, closeDelay: 300 },
        standIn
      )
      scene.focus(trigger)
        .emitted({ _tag: "RequestedOpen" })
        .props({ open: true, closeDelay: 300 })
      scene.mounted(tracking(scene), placed())
      // A press on the positioner is inside.
      scene.fire(positioner, "mouseenter")
        .fireDocument("mousedown")
        .expectDefaultPrevented(false)
      assert.deepStrictEqual(scene.current.emitted, [])
      // Keyboard focus holds the tooltip open after the pointer leaves, and
      // a press elsewhere that leaves focus on the trigger still closes it.
      scene.fire(positioner, "mouseleave")
        .mounted(tracking(scene), sent("LeftHoverArea"))
      assert.deepStrictEqual(scene.current.pending, [])
      scene.fireDocument("mousedown")
        .emitted({ _tag: "RequestedClose" })

      // Without focus, the close delay holds it open, and a press ends the wait.
      scene.fire(trigger, "mouseenter")
        .blur(trigger)
        .fire(trigger, "mouseleave")
        .mounted(tracking(scene), sent("LeftHoverArea"))
      assert.deepStrictEqual(
        scene.current.pending.map((run) => run.command.args),
        [
          { delay: 300 }
        ]
      )
      scene.fireDocument("mousedown")
        .emitted({ _tag: "RequestedClose" })
      assert.deepStrictEqual(scene.current.pending, [])
    }))

  it.effect("a disabled tooltip never shows and emits nothing", () =>
    Effect.gen(function*() {
      const scene = yield* HtmlScene.make(
        Tooltip,
        { open: true, disabled: true },
        standIn
      )
      assert.isFalse(scene.get(positioner).props?.popoverOpen)
      assert.isUndefined(scene.get(trigger).attrs?.disabled)
      scene.fire(trigger, "mouseenter")
        .fire(trigger, "focus")
        .fire(trigger, "mousedown")
        .fire(trigger, "click")
      // It doesn't listen on the document either.
      assert.deepStrictEqual(scene.subscriptions, [])
      assert.deepStrictEqual(scene.current.pending, [])
      assert.deepStrictEqual(scene.current.emitted, [])
    }))

  it("parts clear stale state and add their styles after the consumer's", () => {
    const tooltip = Story.parts(Tooltip, {
      model: {
        onTrigger: false,
        onPositioner: false,
        inArea: false,
        focused: false,
        instant: null,
        turn: 0,
        yieldedTo: null,
        placement: null
      },
      props: { open: false, positionMethod: "fixed" }
    })
    const trigger = View.build(
      tooltip.trigger(h.button.attr("data-popup-open", "")),
      []
    )
    assert.isUndefined(trigger.attrs["data-popup-open"])
    const positioner = View.build(
      tooltip.positioner(h.div).style({ zIndex: "10" }),
      []
    )
    assert.match(
      positioner.attrs.style ?? "",
      /^z-index:10;position:fixed;inset:auto;margin:0;/
    )
  })

  it.effect("describesTrigger makes the popup the trigger's description, next to the consumer's own", () =>
    Effect.gen(function*() {
      const scene = yield* HtmlScene.make(Tooltip, { open: false }, {
        elements: Html,
        view: (tooltip, h) =>
          h.span(
            tooltip.trigger(h.button.attr("aria-describedby", "hint")),
            tooltip.positioner(h.div).children(
              tooltip.popup(h.div.class("popup")).children("Bold")
            )
          )
      })
      const popup = Locator.attr("class", "popup")
      assert.strictEqual(scene.get(trigger).attrs?.["aria-describedby"], "hint")
      assert.isUndefined(scene.get(popup).attrs?.id)
      assert.isUndefined(scene.get(popup).attrs?.role)
      // Closed too: a hidden popover still describes the trigger.
      scene.props({ open: false, describesTrigger: true })
      const id = scene.get(popup).attrs?.id
      assert.isString(id)
      assert.strictEqual(scene.get(popup).attrs?.role, "tooltip")
      assert.strictEqual(
        scene.get(trigger).attrs?.["aria-describedby"],
        `hint ${id}`
      )
    }))

  it.effect("keeps a link trigger native and opens its tooltip on keyboard focus", () =>
    Effect.gen(function*() {
      const scene = yield* HtmlScene.make(
        Tooltip,
        { open: false, describesTrigger: true },
        {
          elements: Html,
          view: (tooltip, h) =>
            h.div(
              tooltip.trigger(h.a.attr("href", "#retention")).children(
                "Retention policy"
              ),
              tooltip.positioner(h.div.class("positioner")).children(
                tooltip.popup(h.div.class("popup")).children("30 days")
              )
            )
        }
      )
      const link = Locator.tag("a")
      const popup = Locator.attr("class", "popup")
      assert.strictEqual(scene.get(link).attrs?.href, "#retention")
      assert.strictEqual(
        scene.get(link).attrs?.["aria-describedby"],
        scene.get(popup).attrs?.id
      )
      scene.fire(link, "focus", { focusVisible: true }).emitted({
        _tag: "RequestedOpen"
      })
      scene.props({ open: true, describesTrigger: true })
      scene.expectMount(tracking(scene))
      scene.fire(link, "click")
        .emitted({ _tag: "RequestedClose" })
        .expectDefaultPrevented(false)
    }))

  it.effect("the placement the positioner reports reaches every part", () =>
    Effect.gen(function*() {
      const scene = yield* HtmlScene.make(
        Tooltip,
        { open: false, side: "bottom" },
        standIn
      )
      const popup = Locator.attr("class", "popup")
      const arrow = Locator.attr("aria-hidden", "true")
      scene.props({ open: true, side: "bottom" })
      assert.strictEqual(scene.get(popup).attrs?.["data-side"], "bottom")
      scene.mounted(
        tracking(scene),
        placed({
          side: "left",
          align: "end",
          anchorHidden: true,
          arrowUncentered: true
        })
      )
      for (const part of [positioner, popup, arrow]) {
        assert.strictEqual(scene.get(part).attrs?.["data-side"], "left")
        assert.strictEqual(scene.get(part).attrs?.["data-align"], "end")
      }
      assert.strictEqual(
        scene.get(positioner).attrs?.["data-anchor-hidden"],
        ""
      )
      assert.strictEqual(scene.get(arrow).attrs?.["data-uncentered"], "")
      assert.include(scene.get(arrow).attrs?.style, "top:var(")
    }))

  it.effect("one click on a trigger stacked under a styled Button reaches both the Button and the tooltip", () =>
    Effect.gen(function*() {
      const root = yield* TestHost.mount(Toolbar, {})
      const button = root.get(trigger)
      assert.strictEqual(button.attrs?.class, "tool")
      assert.strictEqual(button.attrs?.type, "button")
      assert.strictEqual(button.attrs?.["data-popup-open"], "")

      Locator.fire(button, "click")
      yield* TestHost.settle
      // The parent got Button's press and the tooltip's dismissal, once each.
      assert.strictEqual(
        Locator.textOf(root.get(Locator.tag("output"))),
        "pressed 1, dismissed 1"
      )
      assert.isUndefined(root.get(trigger).attrs?.["data-popup-open"])
    }).pipe(Effect.provide(TestHost.layer())))

  it.effect("in a whole app, Escape on the document dismisses the open tooltip, which then stops listening", () =>
    Effect.gen(function*() {
      const root = yield* TestHost.mount(Toolbar, {})
      yield* TestHost.settle
      assert.isTrue(
        yield* TestGlobalEvents.fire("document", "keydown", { key: "Escape" })
      )
      yield* TestHost.settle
      assert.strictEqual(
        Locator.textOf(root.get(Locator.tag("output"))),
        "pressed 0, dismissed 1"
      )
      assert.isFalse(
        yield* TestGlobalEvents.fire("document", "keydown", { key: "Escape" })
      )
    }).pipe(
      Effect.provide(Layer.merge(TestHost.layer(), TestGlobalEvents.layer))
    ))

  it.effect("after one tooltip of a group closes, another opens at once inside the timeout and waits outside it", () =>
    Effect.gen(function*() {
      const root = yield* TestHost.mount(Grouped, {})
      const hover = (tip: string) =>
        Locator.fire(root.get(Locator.attr("aria-label", tip)), "mouseenter")
      const leave = (tip: string) =>
        Locator.fire(root.get(Locator.attr("aria-label", tip)), "mouseleave")
      const instant = (tip: string) =>
        root.get(Locator.attr("class", `${tip}-popup`)).attrs?.["data-instant"]
      const open = () => root.query(Locator.attr("data-popup-open", ""))
      const openTip = () => Locator.textOf(open()!)
      const settle = TestHost.settle
      // Commands start when the host settles, so settle before moving the clock.
      const wait = (millis: number) =>
        settle.pipe(
          Effect.andThen(TestClock.adjust(`${millis} millis`)),
          Effect.andThen(settle)
        )

      // A opens after its hover delay, then the consumer accepts its close.
      hover("bold")
      yield* wait(600)
      assert.strictEqual(openTip(), "bold")
      leave("bold")
      yield* wait(0)
      assert.isUndefined(open())

      // Inside the window, B opens on the hover itself, marked `delay`.
      yield* wait(399)
      hover("italic")
      yield* settle
      assert.strictEqual(openTip(), "italic")
      assert.strictEqual(instant("italic"), "delay")

      // Outside the window, B waits its full delay again.
      leave("italic")
      yield* wait(400)
      hover("italic")
      yield* wait(599)
      assert.isUndefined(open())
      yield* wait(1)
      assert.strictEqual(openTip(), "italic")
      assert.isUndefined(instant("italic"))
    }).pipe(Effect.provide(TestHost.layer())))

  it.effect("a press outside closes a tooltip that Back brought back open", () => {
    const history = Router.memoryHistory("/")
    return Effect.gen(function*() {
      const root = yield* TestHost.mount(Pages, Router.props(PageRoute))
      const open = () => root.query(Locator.attr("data-popup-open", ""))
      yield* TestHost.settle
      Locator.fire(root.get(Locator.attr("aria-label", "bold")), "mouseenter")
      yield* TestHost.settle
      yield* TestClock.adjust("600 millis")
      yield* TestHost.settle
      assert.strictEqual(Locator.textOf(open()!), "bold")

      Locator.fire(root.get(Locator.tag("a")), "click")
      yield* TestHost.settle
      assert.isUndefined(open())
      history.go(-1)
      yield* TestHost.settle
      assert.strictEqual(Locator.textOf(open()!), "bold")

      yield* TestGlobalEvents.fire("document", "mousedown")
      yield* TestHost.settle
      assert.isUndefined(open())
    }).pipe(
      Effect.provide(Router.make({ routes: PageRoute, history })),
      Effect.provide(Layer.merge(TestHost.layer(), TestGlobalEvents.layer))
    )
  })

  it.effect("when another tooltip of the group is shown, one held open asks once to close, and stays if refused", () =>
    Effect.gen(function*() {
      const wait = (millis: number) =>
        TestHost.settle.pipe(
          Effect.andThen(TestClock.adjust(`${millis} millis`)),
          Effect.andThen(TestHost.settle)
        )
      const scene = (
        root: { readonly get: (locator: Locator.Locator) => TestHost.TestNode }
      ) => ({
        fire: (tip: string, event: string, payload?: object) =>
          Locator.fire(
            root.get(Locator.attr("aria-label", tip)),
            event,
            payload
          ),
        shows: (tip: string) =>
          root.get(Locator.attr("aria-label", tip)).attrs
            ?.["data-popup-open"] === "",
        requests: () => Locator.textOf(root.get(Locator.tag("output")))
      })

      // Keyboard focus holds bold open, and the consumer refuses its close.
      const held = scene(
        yield* TestHost.mount(Independent, { keep: true, closeDelay: 0 })
      )
      held.fire("bold", "focus", { focusVisible: true })
      yield* wait(0)
      held.fire("italic", "mouseenter")
      yield* wait(0)
      assert.isTrue(held.shows("italic"))
      assert.strictEqual(held.requests(), "1")
      assert.isTrue(held.shows("bold"))
      // No repeated request while both stay open.
      yield* wait(1000)
      assert.strictEqual(held.requests(), "1")
      assert.isTrue(held.shows("bold"))

      // A close delay holds bold open, and the consumer accepts at once.
      const delayed = scene(
        yield* TestHost.mount(Independent, { keep: false, closeDelay: 1000 })
      )
      delayed.fire("bold", "mouseenter")
      yield* wait(600)
      delayed.fire("bold", "mouseleave")
      delayed.fire("italic", "mouseenter")
      yield* wait(0)
      assert.isTrue(delayed.shows("italic"))
      assert.strictEqual(delayed.requests(), "1")
      assert.isFalse(delayed.shows("bold"))
    }).pipe(Effect.provide(TestHost.layer())))

  it.effect("both opens requested before either is accepted: the one accepted later still replaces the other", () =>
    Effect.gen(function*() {
      const root = yield* TestHost.mount(Deferred, {})
      const wait = (millis: number) =>
        TestHost.settle.pipe(
          Effect.andThen(TestClock.adjust(`${millis} millis`)),
          Effect.andThen(TestHost.settle)
        )
      const fire = (tip: string, event: string, payload?: object) =>
        Locator.fire(root.get(Locator.attr("aria-label", tip)), event, payload)
      const requests = () => Locator.textOf(root.get(Locator.tag("output")))
      const shows = (tip: string) =>
        root.get(Locator.attr("aria-label", tip)).attrs?.["data-popup-open"] ===
          ""

      fire("bold", "focus", { focusVisible: true })
      fire("italic", "mouseenter")
      yield* wait(600)
      root.send(DeferredMessage.AcceptedOpen({ tip: "bold" }))
      yield* wait(0)
      assert.strictEqual(requests(), "0")
      root.send(DeferredMessage.AcceptedOpen({ tip: "italic" }))
      yield* wait(0)
      assert.isTrue(shows("italic"))
      assert.strictEqual(requests(), "1")
      // Refused: bold stays, and isn't asked again.
      yield* wait(1000)
      assert.isTrue(shows("bold"))
      assert.strictEqual(requests(), "1")
    }).pipe(Effect.provide(TestHost.layer())))

  it.effect("tooltips the consumer opens through props, with no request, replace each other too", () =>
    Effect.gen(function*() {
      const root = yield* TestHost.mount(Deferred, {})
      const wait = (millis: number) =>
        TestHost.settle.pipe(
          Effect.andThen(TestClock.adjust(`${millis} millis`)),
          Effect.andThen(TestHost.settle)
        )
      const accept = (tip: typeof Mark.Type, open: boolean) =>
        root.send(
          open
            ? DeferredMessage.AcceptedOpen({ tip })
            : DeferredMessage.AcceptedClose({ tip })
        )
      const requests = () => Locator.textOf(root.get(Locator.tag("output")))
      const shows = (tip: string) =>
        root.get(Locator.attr("aria-label", tip)).attrs?.["data-popup-open"] ===
          ""

      accept("bold", true)
      yield* wait(0)
      accept("italic", true)
      yield* wait(0)
      assert.strictEqual(requests(), "1")
      yield* wait(1000)
      assert.isTrue(shows("bold"))
      assert.strictEqual(requests(), "1")

      // Underline shown: bold asks again, once, for the new tooltip, and
      // italic closes.
      accept("underline", true)
      yield* wait(0)
      assert.strictEqual(requests(), "2")
      assert.isFalse(shows("italic"))

      // Bold closed and shown again is the newest, so underline gives way.
      accept("bold", false)
      yield* wait(0)
      accept("bold", true)
      yield* wait(0)
      assert.isTrue(shows("bold"))
      assert.isFalse(shows("underline"))
      assert.strictEqual(requests(), "2")
    }).pipe(Effect.provide(TestHost.layer())))
})
