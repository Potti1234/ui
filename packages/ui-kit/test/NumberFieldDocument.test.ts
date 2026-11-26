// @vitest-environment happy-dom
import { UiSchema } from "@effect/ui"
import { NumberField, type NumberFieldProps } from "@effect/ui-kit"
import { BrowserHost, Html } from "@effect/ui/html"
import { assert, describe, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { container, notWebKit, popovers, tick } from "./utils/document.ts"

const Value = Schema.NullOr(Schema.Number)
const Message = UiSchema.TaggedEnum({
  Updated: { value: Value, reason: Schema.String },
  Committed: { value: Value, reason: Schema.String }
})

interface Parent {
  readonly vertical?: boolean
  readonly accepts?: (value: number | null) => boolean
  readonly scrubs?: (value: number | null) => boolean
  readonly hideScrubOnCommit?: boolean
}

const mount = Effect.fnUntraced(function*(
  props: Omit<NumberFieldProps, "value">,
  value: number | null = 5,
  {
    accepts = () => true,
    hideScrubOnCommit = false,
    scrubs = () => true,
    vertical = false
  }: Parent = {}
) {
  const log: Array<string> = []
  const Amount = Html.component({
    name: "Amount",
    model: Schema.Struct({ value: Value, committed: Schema.Boolean }),
    message: Message
  }).make({
    init: () => ({ value, committed: false }),
    update: {
      Updated: ($, { reason, value }) => {
        log.push("updated " + value + " " + reason)
        return accepts(value) ? { ...$.model, value } : $.model
      },
      Committed: ($, { reason, value }) => {
        log.push("committed " + value + " " + reason)
        return hideScrubOnCommit ? { ...$.model, committed: true } : $.model
      }
    },
    view: (h, model) =>
      NumberField(h, {
        props: { ...props, value: model.value },
        onEmit: {
          Updated: ({ reason, value }) => Message.Updated({ value, reason }),
          Committed: ({ reason, value }) => Message.Committed({ value, reason })
        },
        view: (numberField) =>
          numberField.root(h.div).children(
            scrubs(model.value) && !model.committed && numberField.scrubArea({
              element: h.span.class("scrub"),
              direction: vertical ? "vertical" : "horizontal"
            }).children(
              h.label.class("label").children("Amount"),
              numberField.scrubAreaCursor(h.span.class("cursor"))
            ),
            numberField.decrement({ element: h.button.class("decrement") }),
            numberField.input(h.input.class("amount")),
            numberField.increment({ element: h.button.class("increment") })
          )
      })
  })
  const app = yield* container
  yield* BrowserHost.mountEffect(Amount, {}, app)
  yield* tick
  const input = app.querySelector<HTMLInputElement>(".amount")!
  const taken = () => log.splice(0)
  return { app, input, taken }
})

const wait = (ms: number) =>
  Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, ms)))

const blocks = (
  input: HTMLInputElement,
  key: string,
  init: KeyboardEventInit = {}
) =>
  !input.dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      ...init
    })
  )

const select = (
  input: HTMLInputElement,
  text: string,
  start: number,
  end = start
) => {
  input.value = text
  input.setSelectionRange(start, end)
}

const paste = (input: HTMLInputElement, text: string) => {
  const clipboardData = new DataTransfer()
  clipboardData.setData("text/plain", text)
  return !input.dispatchEvent(
    new ClipboardEvent("paste", {
      clipboardData,
      bubbles: true,
      cancelable: true
    })
  )
}

// happy-dom's WheelEvent drops the modifier keys.
const turn = (target: HTMLInputElement, init: WheelEventInit) =>
  !target.dispatchEvent(
    Object.assign(
      new WheelEvent("wheel", { bubbles: true, cancelable: true, ...init }),
      {
        shiftKey: init.shiftKey ?? false,
        altKey: init.altKey ?? false,
        ctrlKey: init.ctrlKey ?? false
      }
    )
  )

const pointer = (
  target: EventTarget,
  type: string,
  init: PointerEventInit = {}
) =>
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      pointerType: "mouse",
      ...init
    })
  )

const type = (input: HTMLInputElement, text: string) => {
  input.focus()
  input.value = text
  input.dispatchEvent(new Event("input", { bubbles: true }))
}

// WebKit is never asked for the lock.
const pointerLock = Effect.acquireRelease(
  Effect.sync(() => {
    let held: Element | null = null
    const change = (element: Element | null) => {
      held = element
      document.dispatchEvent(new Event("pointerlockchange"))
    }
    Object.defineProperty(document, "pointerLockElement", {
      configurable: true,
      get: () => held
    })
    Object.assign(document, {
      exitPointerLock: () => held !== null && change(null)
    })
    Object.assign(document.body, {
      requestPointerLock: () =>
        Promise.resolve().then(() => change(document.body))
    })
    return { held: () => held, lose: () => change(null) }
  }),
  () =>
    Effect.sync(() => {
      Reflect.deleteProperty(document, "pointerLockElement")
      Reflect.deleteProperty(document, "exitPointerLock")
      Reflect.deleteProperty(document.body, "requestPointerLock")
    })
).pipe(Effect.tap(popovers), Effect.tap(notWebKit))

const firefox = Effect.acquireRelease(
  Effect.sync(() =>
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 Gecko/20100101 Firefox/157.0"
    })
  ),
  () => Effect.sync(() => Reflect.deleteProperty(navigator, "userAgent"))
)

describe("NumberField in a document", { concurrent: false }, () => {
  it.effect("filters keys by locale, format, and range", () =>
    Effect.gen(function*() {
      const { input } = yield* mount({ locale: "en-US", min: -100 })
      select(input, "12.5", 4)
      assert.isTrue(blocks(input, "a"))
      assert.isTrue(blocks(input, "."))
      assert.isTrue(blocks(input, "€"))
      assert.isFalse(blocks(input, "7"))
      assert.isFalse(blocks(input, ","))
      assert.isFalse(blocks(input, "Backspace"))
      assert.isFalse(blocks(input, "a", { ctrlKey: true }))
      assert.isFalse(blocks(input, "a", { isComposing: true }))
      select(input, "12.5", 0, 4)
      assert.isFalse(blocks(input, "."))
      select(input, "12.5", 0)
      assert.isFalse(blocks(input, "-"))
      select(input, "-12.5", 5)
      assert.isTrue(blocks(input, "-"))
      select(input, "-12.5", 0, 1)
      assert.isFalse(blocks(input, "+"))

      const positive = yield* mount({ locale: "en-US", min: 0 })
      select(positive.input, "12.5", 0)
      assert.isTrue(blocks(positive.input, "-"))

      const eur = yield* mount({
        locale: "de-DE",
        format: { style: "currency", currency: "EUR" }
      })
      select(eur.input, "2.345,75 ", 9)
      assert.isFalse(blocks(eur.input, "€"))
      assert.isTrue(blocks(eur.input, "$"))
      assert.isTrue(blocks(eur.input, ","))
      assert.isFalse(blocks(eur.input, "."))
      select(eur.input, "2.345,75 €", 10)
      assert.isTrue(blocks(eur.input, "€"))
    }))

  it.effect("accepts both apostrophes for grouping in Swiss German", () =>
    Effect.gen(function*() {
      const { input, taken } = yield* mount({ locale: "de-CH" }, null)
      for (
        const [separator, value, text] of [
          ["'", 1234.25, "1'234.25"],
          ["’", 2345.75, "2’345.75"]
        ] as const
      ) {
        assert.isFalse(blocks(input, separator))
        select(input, "", 0)
        assert.isTrue(paste(input, text))
        yield* tick
        assert.strictEqual(input.value, text)
        assert.deepStrictEqual(taken(), ["updated " + value + " input-paste"])
      }

      const english = yield* mount({ locale: "en-US" }, null)
      assert.isTrue(blocks(english.input, "'"))
      assert.isTrue(blocks(english.input, "’"))
    }).pipe(Effect.scoped))

  it.effect("inserts sanitized pasted text at the caret and drops non-numeric paste", () =>
    Effect.gen(function*() {
      const { input, taken } = yield* mount({ locale: "en-US" }, 0)
      select(input, "0", 1)
      assert.isTrue(paste(input, "1,234"))
      assert.strictEqual(input.value, "01,234")
      assert.deepStrictEqual([input.selectionStart, input.selectionEnd], [6, 6])
      yield* tick
      assert.deepStrictEqual(taken(), ["updated 1234 input-paste"])
      input.setSelectionRange(0, 6)
      assert.isTrue(paste(input, "USD 1,250.75 total"))
      assert.strictEqual(input.value, "1,250.75")
      yield* tick
      assert.deepStrictEqual(taken(), ["updated 1250.75 input-paste"])
      input.setSelectionRange(1, 1)
      assert.isTrue(paste(input, "abc"))
      assert.strictEqual(input.value, "1,250.75")
      input.setSelectionRange(0, 8)
      assert.isTrue(paste(input, "-"))
      assert.strictEqual(input.value, "1,250.75")
      yield* tick
      assert.deepStrictEqual(taken(), [])
    }))

  it.effect("stepper press steps, repeats while held, commits on release, and ignores secondary or mouse clicks", () =>
    Effect.gen(function*() {
      const { app, input, taken } = yield* mount({ locale: "en-US", max: 12 })
      const increment = app.querySelector<HTMLButtonElement>(".increment")!
      const decrement = app.querySelector<HTMLButtonElement>(".decrement")!
      pointer(decrement, "pointerdown", { button: 2 })
      decrement.dispatchEvent(
        new MouseEvent("click", { bubbles: true, detail: 1 })
      )
      yield* tick
      assert.deepStrictEqual(taken(), [])

      assert.isFalse(pointer(increment, "pointerdown"))
      yield* tick
      assert.deepStrictEqual(taken(), ["updated 6 increment-press"])
      assert.strictEqual(document.activeElement, input)
      assert.deepStrictEqual([input.selectionStart, input.selectionEnd], [1, 1])
      yield* wait(250)
      assert.deepStrictEqual(taken(), [])
      yield* wait(700)
      assert.deepStrictEqual(
        taken(),
        [7, 8, 9, 10, 11, 12].map((value) =>
          "updated " + value + " increment-press"
        )
      )
      assert.strictEqual(increment.getAttribute("aria-disabled"), "true")
      pointer(window, "pointerup")
      yield* tick
      assert.deepStrictEqual(taken(), ["committed 12 increment-press"])
      assert.strictEqual(input.value, "12")
      yield* wait(200)
      assert.deepStrictEqual(taken(), [])

      decrement.dispatchEvent(
        new MouseEvent("click", { bubbles: true, detail: 0, shiftKey: true })
      )
      yield* tick
      assert.deepStrictEqual(taken(), [
        "updated 2 decrement-press",
        "committed 2 decrement-press"
      ])
    }))

  it.effect("wheel steps only a focused input when allowWheelScrub is set", () =>
    Effect.gen(function*() {
      const { input, taken } = yield* mount({
        locale: "en-US",
        allowWheelScrub: true
      })
      assert.isFalse(turn(input, { deltaY: 100 }))
      input.focus()
      assert.isTrue(turn(input, { deltaY: 100 }))
      assert.isTrue(turn(input, { deltaY: -100, shiftKey: true }))
      assert.isFalse(turn(input, { deltaX: 100 }))
      assert.isFalse(turn(input, { deltaY: 100, ctrlKey: true }))
      yield* tick
      assert.deepStrictEqual(taken(), [
        "updated 4 wheel",
        "committed 4 wheel",
        "updated 14 wheel",
        "committed 14 wheel"
      ])
      const still = yield* mount({ locale: "en-US" })
      still.input.focus()
      assert.isFalse(turn(still.input, { deltaY: 100 }))
      yield* tick
      assert.deepStrictEqual(still.taken(), [])
    }))

  it.effect("unlocked horizontal and vertical scrub drags step by pointer distance and commit on release", () =>
    Effect.gen(function*() {
      const { app, input, taken } = yield* mount({ locale: "en-US" })
      const area = app.querySelector<HTMLElement>(".scrub")!
      const root = app.firstElementChild!
      assert.isFalse(pointer(area, "pointerdown", { clientX: 10, clientY: 10 }))
      yield* tick
      assert.isTrue(root.hasAttribute("data-scrubbing"))
      assert.strictEqual(document.activeElement, input)
      assert.isNull(app.querySelector(".cursor"))
      pointer(window, "pointermove", { clientX: 14, clientY: 30 })
      pointer(window, "pointermove", { clientX: 15, clientY: 30 })
      pointer(window, "pointermove", {
        clientX: 12,
        clientY: 30,
        shiftKey: true
      })
      yield* tick
      assert.deepStrictEqual(taken(), ["updated 9 scrub", "updated -21 scrub"])
      pointer(window, "pointerup")
      yield* tick
      assert.deepStrictEqual(taken(), ["committed -21 scrub"])
      assert.isFalse(root.hasAttribute("data-scrubbing"))
      assert.strictEqual(input.value, "-21")
      pointer(window, "pointermove", { clientX: 40, clientY: 30 })
      yield* tick
      assert.deepStrictEqual(taken(), [])

      const vertical = yield* mount({ locale: "en-US" }, 5, { vertical: true })
      pointer(vertical.app.querySelector(".scrub")!, "pointerdown", {
        clientX: 10,
        clientY: 40
      })
      pointer(window, "pointermove", { clientX: 90, clientY: 36 })
      pointer(window, "pointerup")
      yield* tick
      assert.deepStrictEqual(vertical.taken(), [
        "updated 9 scrub",
        "committed 9 scrub"
      ])
    }))

  it.effect("locked pointer scrub shows popover cursor, steps by movement, and keeps scrubbing if lock is lost", () =>
    Effect.gen(function*() {
      const lock = yield* pointerLock
      const { app, taken } = yield* mount({ locale: "en-US" })
      pointer(app.querySelector(".scrub")!, "pointerdown", {
        clientX: 10,
        clientY: 10
      })
      yield* tick
      assert.strictEqual(lock.held(), document.body)
      const cursor = app.querySelector<HTMLElement>(".cursor")!
      assert.isNotNull(cursor)
      assert.strictEqual(cursor.getAttribute("popover"), "manual")
      assert.strictEqual(cursor.getAttribute("aria-hidden"), "true")
      assert.isNull(cursor.getAttribute("role"))
      pointer(window, "pointermove", { clientX: 10, clientY: 10, movementX: 4 })
      yield* tick
      assert.deepStrictEqual(taken(), ["updated 9 scrub"])
      lock.lose()
      yield* tick
      assert.isNull(app.querySelector(".cursor"))
      assert.isTrue(app.firstElementChild!.hasAttribute("data-scrubbing"))
      pointer(window, "pointermove", {
        clientX: 13,
        clientY: 10,
        movementX: 50
      })
      pointer(window, "pointerup")
      yield* tick
      assert.deepStrictEqual(taken(), [
        "updated 12 scrub",
        "committed 12 scrub"
      ])
    }))

  it.effect("post-release pointermove during Firefox unlock delay changes nothing and preserves label click", () =>
    Effect.gen(function*() {
      yield* firefox
      const lock = yield* pointerLock
      const { app, taken } = yield* mount({ locale: "en-US" })
      const label = app.querySelector<HTMLElement>(".label")!
      let clicks = 0
      label.addEventListener("click", () => clicks++)
      pointer(label, "pointerdown", { clientX: 10, clientY: 10 })
      yield* tick
      pointer(window, "pointerup")
      assert.strictEqual(lock.held(), document.body)
      pointer(window, "pointermove", {
        clientX: 10,
        clientY: 10,
        movementX: 10,
        buttons: 0
      })
      yield* tick
      assert.isNull(lock.held())
      assert.deepStrictEqual(taken(), ["committed 5 scrub"])
      assert.strictEqual(clicks, 1)
    }))

  it.effect("removing the scrub area mid-drag releases lock, clears data-scrubbing, and does not commit", () =>
    Effect.gen(function*() {
      const lock = yield* pointerLock
      const { app, taken } = yield* mount({ locale: "en-US" }, 5, {
        scrubs: (value) => value === 5
      })
      pointer(app.querySelector(".scrub")!, "pointerdown", {
        clientX: 10,
        clientY: 10
      })
      yield* tick
      pointer(window, "pointermove", { clientX: 10, clientY: 10, movementX: 4 })
      yield* tick
      assert.isNull(app.querySelector(".scrub"))
      assert.isNull(app.querySelector(".cursor"))
      assert.isNull(lock.held())
      assert.isFalse(app.firstElementChild!.hasAttribute("data-scrubbing"))
      pointer(window, "pointerup")
      yield* tick
      assert.deepStrictEqual(taken(), ["updated 9 scrub"])
    }))

  it.effect("removing the scrub area on commit still releases the delayed pointer lock in Firefox", () =>
    Effect.gen(function*() {
      yield* firefox
      const lock = yield* pointerLock
      const { app, taken } = yield* mount({ locale: "en-US" }, 5, {
        hideScrubOnCommit: true
      })
      pointer(app.querySelector(".scrub")!, "pointerdown", {
        clientX: 10,
        clientY: 10
      })
      yield* tick
      assert.strictEqual(lock.held(), document.body)
      pointer(window, "pointerup")
      yield* tick
      assert.isNull(app.querySelector(".scrub"))
      assert.isNull(lock.held())
      assert.deepStrictEqual(taken(), ["committed 5 scrub"])
    }))

  it.effect("pointercancel scoped to pointerId stops a stepper hold and ends an active scrub drag", () =>
    Effect.gen(function*() {
      const { app, taken } = yield* mount({ locale: "en-US" })
      const increment = app.querySelector<HTMLButtonElement>(".increment")!
      const touch = { pointerType: "touch", pointerId: 7 }
      pointer(increment, "pointerdown", touch)
      pointer(window, "pointercancel", touch)
      yield* wait(600)
      assert.deepStrictEqual(taken(), [])
      pointer(increment, "pointerdown", touch)
      yield* wait(560)
      const beforeOtherCancel = taken()
      assert.isAbove(beforeOtherCancel.length, 1)
      assert.isFalse(
        beforeOtherCancel.some((entry) => entry.startsWith("committed "))
      )
      pointer(window, "pointercancel", { pointerType: "touch", pointerId: 8 })
      yield* wait(150)
      const afterOtherCancel = taken()
      assert.isAbove(afterOtherCancel.length, 0)
      assert.isFalse(
        afterOtherCancel.some((entry) => entry.startsWith("committed "))
      )
      pointer(window, "pointercancel", touch)
      yield* tick
      const afterCancel = taken()
      const totalSteps = beforeOtherCancel.length + afterOtherCancel.length +
        afterCancel.length - 1
      assert.strictEqual(
        afterCancel.filter((entry) => entry.startsWith("committed ")).length,
        1
      )
      assert.strictEqual(
        afterCancel.at(-1),
        "committed " + (5 + totalSteps) + " increment-press"
      )
      yield* wait(200)
      assert.deepStrictEqual(taken(), [])
      pointer(app.querySelector(".scrub")!, "pointerdown", {
        ...touch,
        clientX: 10,
        clientY: 10
      })
      pointer(window, "pointermove", { ...touch, clientX: 14, clientY: 10 })
      pointer(window, "pointercancel", touch)
      pointer(window, "pointermove", { ...touch, clientX: 30, clientY: 10 })
      yield* tick
      const value = 5 + totalSteps + 4
      assert.deepStrictEqual(taken(), [
        "updated " + value + " scrub",
        "committed " + value + " scrub"
      ])
      assert.isFalse(app.firstElementChild!.hasAttribute("data-scrubbing"))
    }))

  it.effect("refused edits restore displayed text on blur without committing, and stepper release commits props.value", () =>
    Effect.gen(function*() {
      const { app, input, taken } = yield* mount({ locale: "en-US" }, 5, {
        accepts: () => false
      })
      type(input, "19")
      yield* tick
      input.blur()
      yield* tick
      assert.deepStrictEqual(taken(), [
        "updated 19 input-change",
        "updated 19 input-blur"
      ])
      assert.strictEqual(input.value, "5")
      type(input, "")
      yield* tick
      input.blur()
      yield* tick
      assert.deepStrictEqual(taken(), [
        "updated null input-clear",
        "updated null input-clear"
      ])
      assert.strictEqual(input.value, "5")
      pointer(app.querySelector(".increment")!, "pointerdown")
      pointer(window, "pointerup")
      yield* tick
      assert.deepStrictEqual(taken(), [
        "updated 6 increment-press",
        "committed 5 increment-press"
      ])
    }))

  it.effect("disabled field takes no press, drag, or wheel", () =>
    Effect.gen(function*() {
      const { app, input, taken } = yield* mount({
        locale: "en-US",
        disabled: true,
        allowWheelScrub: true
      })
      assert.isTrue(pointer(app.querySelector(".increment")!, "pointerdown"))
      pointer(window, "pointerup")
      assert.isTrue(pointer(app.querySelector(".scrub")!, "pointerdown"))
      assert.isTrue(pointer(window, "pointermove", { movementX: 9 }))
      pointer(window, "pointerup")
      assert.isFalse(turn(input, { deltaY: 100 }))
      yield* tick
      assert.deepStrictEqual(taken(), [])
    }))
})
