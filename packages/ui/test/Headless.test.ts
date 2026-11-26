import {
  Component,
  Feature,
  type MessageLog,
  UiSchema,
  type View
} from "@effect/ui"
import { Html } from "@effect/ui/html"
import { Locator, TestHost } from "@effect/ui/testing"
import { assert, describe, it } from "@effect/vitest"
import { Cause, Effect, Layer, Schema } from "effect"
import { Dialog, type Item, Menu } from "./html/fixtures/headless.ts"

const provideHost = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.provide(TestHost.layer()))
const click = (
  root: { readonly get: (locator: Locator.Locator) => TestHost.TestNode },
  text: string
) => Locator.fire(root.get(Locator.text(text, { exact: true })), "click")
const updates = (
  root: { readonly log: () => ReadonlyArray<MessageLog.Entry> }
) =>
  root.log().flatMap((entry) =>
    entry._tag === "Update"
      ? [
        entry.path + " " + entry.source._tag + " " + (entry.message as any)._tag
      ]
      : []
  )
const failures = (
  root: { readonly log: () => ReadonlyArray<MessageLog.Entry> }
) =>
  root.log().flatMap((entry) =>
    entry._tag === "Failed" ? [entry.path + " " + entry.in] : []
  )

const items: ReadonlyArray<Item> = [
  { id: "a", label: "Archive" },
  { id: "b", label: "Block", disabled: true },
  { id: "c", label: "Copy" }
]

// ---------------------------------------------------------------------------
// Three owners on one element: a Menu inside a Dialog, both placed by Picker
// ---------------------------------------------------------------------------

const PickerMessage = UiSchema.TaggedEnum({
  Picked: { id: Schema.String },
  Closed: {},
  Clicked: { id: Schema.String }
})

const Picker = Html.component({
  name: "Picker",
  model: Schema.Array(Schema.String),
  message: PickerMessage
}).make({
  init: () => [],
  update: ($, message) => [
    ...$.model,
    PickerMessage.match(message, {
      Picked: ({ id }) => "picked " + id,
      Closed: () => "closed",
      Clicked: ({ id }) => "clicked " + id
    })
  ],
  view: (h, log) =>
    Dialog(h, {
      key: "confirm",
      props: { label: "Confirm" },
      onEmit: () => PickerMessage.Closed(),
      view: (dialog) =>
        h.div(
          dialog.trigger(h.button).children("Open"),
          dialog.popup(h.dialog).children(
            dialog.title(h.h2).children("Pick one"),
            Menu(h, {
              key: "actions",
              props: { items },
              onEmit: (event) => PickerMessage.Picked({ id: event.id }),
              view: (menu) =>
                h.ul.children(menu.visible.map((item) =>
                  dialog.close(menu.item(h.li.key(item.id), item))
                    .on("click", PickerMessage.Clicked({ id: item.id }))
                    .children(item.label)
                ))
            })
          ),
          h.output(log.join(", "))
        )
    })
})

// ---------------------------------------------------------------------------
// A stateful normal child declared inside a headless child's closure
// ---------------------------------------------------------------------------

const BellMessage = UiSchema.TaggedEnum({ Ring: {}, Break: {} })

const Bell = Html.component({
  name: "Bell",
  model: Schema.Number,
  message: BellMessage,
  events: Schema.Literal("rang")
}).make({
  init: () => 0,
  update: ($, message) =>
    BellMessage.match(message, {
      Ring: () => $.set($.model + 1).emit("rang"),
      Break: () => {
        throw new Error("the bell broke")
      }
    }),
  view: (h, count) =>
    h.span(
      h.button.on("click", BellMessage.Ring()).children("ring " + count),
      h.button.on("click", BellMessage.Break()).children("break")
    )
})

const BoardMessage = UiSchema.TaggedEnum({ Rang: {}, Failed: {} })

const Board = Html.component({
  name: "Board",
  props: Schema.Struct({ fallbackThrows: Schema.Boolean }),
  model: Schema.Array(Schema.String),
  message: BoardMessage
}).make({
  init: () => [],
  update: ($, message) => [...$.model, message._tag],
  view: (h, log) =>
    Menu(h, {
      key: "actions",
      props: { items },
      view: (menu) =>
        menu.popup(h.div).children(
          Bell(h, {
            key: "bell",
            onEmit: () => BoardMessage.Rang(),
            onFailure: () => BoardMessage.Failed(),
            fallback: () => {
              if (h.props.fallbackThrows) throw new Error("no fallback")
              return h.span("bell down")
            }
          }),
          h.output(log.join(", "))
        )
    })
})

// ---------------------------------------------------------------------------
// A feature child in a closure, under a Layer that never finishes building
// ---------------------------------------------------------------------------

class Badge
  extends Feature.Service<Badge>()("Badge", { props: Schema.Struct({}) })
{}
const BadgeImpl = Component.define({
  name: "BadgeImpl",
  model: Schema.Null,
  message: Schema.Never
})
  .make({
    init: () => null,
    update: ($) => $.model,
    view: (h) => h.el("span", "badge")
  })
const Bare = Component.define({
  name: "Bare",
  model: Schema.Null,
  message: Schema.Never
}).make({
  init: () => null,
  update: ($) => $.model,
  parts: () => ({})
})
const ConsumerMessage = UiSchema.TaggedEnum({ Break: {} })
const Consumer = Component.define({
  name: "Consumer",
  props: Schema.Struct({ throwsAt: Schema.Literals(["mount", "re-render"]) }),
  model: Schema.Boolean,
  message: ConsumerMessage
}).make({
  init: ($) => $.props.throwsAt === "mount",
  update: () => true,
  view: (h, broken) =>
    h.el(
      "div",
      h.el("button").on("click", ConsumerMessage.Break()).children("break"),
      Bare(h, {
        key: "h",
        fallback: () => h.text("headless down"),
        view: () =>
          Badge.render(h, {
            key: "b",
            fallback: () => {
              if (broken) throw new Error("the fallback threw")
              return h.text("loading")
            }
          })
      })
    )
})
const Provided = Component.provide(
  Consumer,
  Layer.merge(Badge.toLayer(BadgeImpl), Layer.effectDiscard(Effect.never))
)
const Waiting = Component.define({
  name: "Waiting",
  props: Schema.Struct({ throwsAt: Schema.Literals(["mount", "re-render"]) }),
  model: Schema.Null,
  message: Schema.Never
}).make({
  init: () => null,
  update: ($) => $.model,
  view: (h) =>
    Provided(h, {
      key: "c",
      props: { throwsAt: h.props.throwsAt },
      fallback: () => h.text("consumer down")
    })
})

// ---------------------------------------------------------------------------
// Token lists: a part adds to the consumer's class and aria-describedby
// ---------------------------------------------------------------------------

const Field = Html.component({
  name: "Field",
  model: Schema.Null,
  message: Schema.Never
}).make({
  init: () => null,
  update: ($) => $.model,
  parts: (p) => ({
    input: p.part(
      "input",
      (b) =>
        b.class(undefined).class("field").attr("aria-describedby", undefined)
          .attr("aria-describedby", "hint")
    )
  })
})

const Form = Html.component({
  name: "Form",
  model: Schema.Null,
  message: Schema.Never
}).make({
  init: () => null,
  update: ($) => $.model,
  // One list set before the part is applied, and one after.
  view: (h) =>
    Field(
      h,
      {
        key: "f",
        view: (field) =>
          field.input(h.input.class("wide field")).attr(
            "aria-describedby",
            "note"
          )
      }
    )
})

const Shell = Html.component({
  name: "Shell",
  props: Schema.Struct({ fallbackThrows: Schema.Boolean }),
  model: Schema.Null,
  message: Schema.Never
}).make({
  init: () => null,
  update: ($) => $.model,
  view: (h) =>
    Board(h, {
      key: "board",
      props: h.props,
      fallback: () => h.p("board down")
    })
})

const ProbeMessage = UiSchema.TaggedEnum({ Read: {} })

const Probe = Html.component({
  name: "Probe",
  props: Schema.Struct({ count: Schema.Number }),
  model: Schema.Array(Schema.Number),
  message: ProbeMessage
}).make({
  init: (): ReadonlyArray<number> => [],
  update: ($) => [...$.model, $.props.count],
  view: (h, read) =>
    h.button.on("click", ProbeMessage.Read()).children(
      "read [" + read.join(",") + "]"
    )
})

const Counted = Html.component({
  name: "Counted",
  model: Schema.Number,
  message: Schema.Literal("bump")
}).make({
  init: () => 0,
  update: ($) => $.model + 1,
  view: (h, count) =>
    Menu(h, {
      key: "m",
      props: { items },
      view: (menu) =>
        h.div(
          menu.trigger(h.button).children("toggle"),
          h.button.on("click", "bump").children("bump"),
          Probe(h, { key: "p", props: { count } })
        )
    })
})

describe("headless components", () => {
  it.effect("a child in the closure reads the props its author gives, though the headless component hasn't drawn them yet", () =>
    provideHost(Effect.gen(function*() {
      const root = yield* TestHost.mount(Counted, {})
      yield* TestHost.settle
      click(root, "bump")
      click(root, "toggle")
      click(root, "read []")
      yield* TestHost.settle
      assert.include(root.text(), "read [1]")
    })))

  it.effect("three owners on one element each get the event, deepest first and the author last", () =>
    provideHost(Effect.gen(function*() {
      const root = yield* TestHost.mount(Picker, {})
      click(root, "Copy")
      yield* TestHost.settle
      // Menu and Dialog each run their own update, and what they emit reaches whoever declared them.
      assert.deepStrictEqual(updates(root), [
        "/Picker/Dialog[confirm]/Menu[actions] DomEvent Pick",
        "/Picker Emit Picked",
        "/Picker/Dialog[confirm] DomEvent Close",
        "/Picker Emit Closed",
        "/Picker DomEvent Clicked"
      ])
      assert.deepStrictEqual(root.model(), ["picked c", "closed", "clicked c"])
      assert.include(root.text(), "picked c, closed, clicked c")
      assert.deepStrictEqual(
        (root.get(
          Locator.text("Copy", { exact: true })
        ) as TestHost.TestElement).owners,
        {
          click: [
            "/Picker/Dialog[confirm]/Menu[actions]",
            "/Picker/Dialog[confirm]",
            "/Picker"
          ]
        }
      )
    })))

  it.effect("a normal child inside the closure reports to whoever wrote the closure, never to the headless one", () =>
    provideHost(Effect.gen(function*() {
      const root = yield* TestHost.mount(Shell, { fallbackThrows: false })
      click(root, "ring 0")
      yield* TestHost.settle
      // The closure ran again for Board's new Model, and Bell kept its own.
      click(root, "ring 1")
      yield* TestHost.settle
      click(root, "break")
      yield* TestHost.settle
      assert.deepStrictEqual(updates(root), [
        "/Shell/Board[board]/Menu[actions]/Bell[bell] DomEvent Ring",
        "/Shell/Board[board] Emit Rang",
        "/Shell/Board[board]/Menu[actions]/Bell[bell] DomEvent Ring",
        "/Shell/Board[board] Emit Rang",
        "/Shell/Board[board] Failure Failed"
      ])
      assert.deepStrictEqual(failures(root), [
        "/Shell/Board[board]/Menu[actions]/Bell[bell] update"
      ])
      assert.include(root.text(), "bell down")
      assert.include(root.text(), "Rang, Rang, Failed")
    })))

  it.effect("a part adds its tokens to a token list, whenever the consumer set it", () =>
    provideHost(Effect.gen(function*() {
      const root = yield* TestHost.mount(Form, {})
      const input = root.get(Locator.tag("input")) as TestHost.TestElement
      assert.strictEqual(input.attrs.class, "wide field")
      assert.strictEqual(input.attrs["aria-describedby"], "note hint")
    })))

  it.effect("a part removes consumer attributes explicitly, without touching attributes it leaves alone", () =>
    provideHost(Effect.gen(function*() {
      const Control = Html.component({
        name: "Control",
        props: Schema.Struct({ active: Schema.Boolean }),
        model: Schema.Null,
        message: Schema.Never
      }).make({
        init: () => null,
        update: ($) => $.model,
        parts: (p) => ({
          root: p.part("button", (b) =>
            b.disabled(p.props.active)
              .attr("aria-readonly", p.props.active ? "true" : undefined)
              .attr("data-checked", p.props.active ? "" : undefined)
              .attr("title", undefined).attr("title", "part")
              .attr("data-removed", "part").attr("data-removed", undefined)
              .class("part"))
        })
      })
      const Consumer = Html.component({
        name: "Consumer",
        model: Schema.Boolean,
        message: Schema.Literal("toggle")
      }).make({
        init: () => false,
        update: ($) => !$.model,
        view: (h, active) =>
          h.div(
            h.button.on("click", "toggle").children("toggle"),
            Control(h, {
              key: "control",
              props: { active },
              view: (control) =>
                control.root(
                  h.button.disabled(true).attrs({
                    "aria-readonly": "true",
                    "data-checked": "",
                    "data-removed": "consumer",
                    title: "consumer",
                    "aria-label": "Keep me"
                  }).class("consumer")
                ).children("control")
            })
          )
      })
      const root = yield* TestHost.mount(Consumer, {})
      const attrs = () =>
        (root.get(
          Locator.text("control", { exact: true })
        ) as TestHost.TestElement).attrs
      const kept = {
        title: "part",
        "aria-label": "Keep me",
        class: "consumer part"
      }
      assert.deepStrictEqual(attrs(), kept)
      click(root, "toggle")
      yield* TestHost.settle
      assert.deepStrictEqual(attrs(), {
        ...kept,
        disabled: "",
        "aria-readonly": "true",
        "data-checked": ""
      })
      click(root, "toggle")
      yield* TestHost.settle
      assert.deepStrictEqual(attrs(), kept)
    })))

  it.effect("an element written by hand leaves owned out", () =>
    provideHost(Effect.gen(function*() {
      const Hand = Component.define({
        name: "Hand",
        model: Schema.Number,
        message: Schema.Literal("hit")
      }).make({
        init: () => 0,
        update: ($) => $.model + 1,
        view: (_, count): View.Element<"hit"> => ({
          _tag: "Element",
          tag: "button",
          elementKey: undefined,
          attrs: {},
          props: {},
          handlers: { click: "hit" },
          eventOptions: {},
          refKey: undefined,
          mount: undefined,
          children: [{ _tag: "Text", text: "hits " + count }]
        })
      })
      const root = yield* TestHost.mount(Hand, {})
      click(root, "hits 0")
      yield* TestHost.settle
      assert.strictEqual(root.text(), "hits 1")
    })))

  it.effect("a fallback that throws inside the closure fails whoever wrote it", () =>
    provideHost(Effect.gen(function*() {
      const root = yield* TestHost.mount(Shell, { fallbackThrows: true })
      click(root, "break")
      yield* TestHost.settle
      assert.deepStrictEqual(failures(root), [
        "/Shell/Board[board]/Menu[actions]/Bell[bell] update",
        "/Shell/Board[board] fallback"
      ])
      assert.strictEqual(root.text(), "board down")
    })))

  for (const when of ["mount", "re-render"] as const) {
    it.effect(`a feature's fallback in a closure that throws on ${when} fails whoever wrote it`, () =>
      provideHost(Effect.gen(function*() {
        const root = yield* TestHost.mount(Waiting, { throwsAt: when })
        yield* TestHost.settle
        if (when === "re-render") {
          assert.strictEqual(root.text(), "breakloading")
          click(root, "break")
          yield* TestHost.settle
        }
        assert.deepStrictEqual(failures(root), [
          "/Waiting/Consumer[c] fallback"
        ])
        assert.strictEqual(root.text(), "consumer down")
      })))
  }

  for (const where of ["view", "closure"] as const) {
    it.effect(`a ${where} that returns an array fails instead of rendering nothing`, () =>
      provideHost(Effect.gen(function*() {
        const DisclosureMessage = UiSchema.TaggedEnum({ Toggled: {} })
        const Disclosure = Html.component({
          name: "Disclosure",
          model: Schema.Boolean,
          message: DisclosureMessage
        }).make({
          init: () => false,
          update: { Toggled: ($) => !$.model },
          parts: (p, open) => ({
            open,
            trigger: p.part(
              "button",
              (button) => button.on("click", DisclosureMessage.Toggled())
            )
          })
        })
        const Pair = Html.component({
          name: "Pair",
          model: Schema.Null,
          message: Schema.Never
        }).make({
          init: () => null,
          update: ($) => $.model,
          view: (h) =>
            [h.button("Toggle"), h.output("false")] as unknown as View.Node<
              never,
              never
            >
        })
        const Parent = Html.component({
          name: "Parent",
          model: Schema.Null,
          message: Schema.Never
        }).make({
          init: () => null,
          update: ($) => $.model,
          view: (h) =>
            h.div(
              where === "view"
                ? Pair(h, { key: "d" })
                : Disclosure(h, {
                  key: "d",
                  view: (disclosure) =>
                    [
                      disclosure.trigger(h.button).children("Toggle"),
                      h.output(String(disclosure.open))
                    ] as unknown as View.Node<never, never>
                })
            )
        })
        const root = yield* TestHost.mount(Parent, {})
        yield* TestHost.settle
        assert.deepStrictEqual(failures(root), [
          where === "view"
            ? "/Parent/Pair[d] view"
            : "/Parent/Disclosure[d] view"
        ])
        assert.strictEqual(root.text(), "")
        assert.include(
          Cause.pretty(
            root.log().find((entry): entry is MessageLog.Failed =>
              entry._tag === "Failed"
            )!.cause
          ),
          "a view returns one node, and was given an array"
        )
      })))
  }
})
