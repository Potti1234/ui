import { clamp } from "./range.ts"

export type Locale = string | ReadonlyArray<string> | undefined

export type Format = Intl.NumberFormatOptions & {
  readonly roundingIncrement?: number | undefined
  readonly roundingMode?: string | undefined
  readonly roundingPriority?: string | undefined
  readonly trailingZeroDisplay?: string | undefined
}

const cached = <A>(store: Map<string, A>, key: unknown, make: () => A): A => {
  const id = JSON.stringify(key)
  let value = store.get(id)
  if (value === undefined) {
    value = make()
    store.set(id, value)
  }
  return value
}

const formatters = new Map<string, Intl.NumberFormat>()

const formatterOf = (locale: Locale, format?: Format): Intl.NumberFormat =>
  cached(
    formatters,
    { locale, format },
    () =>
      new Intl.NumberFormat(
        locale as string | Array<string> | undefined,
        format
      )
  )

export const formatNumber = (
  value: number | null,
  locale: Locale,
  format?: Format
): string => value === null ? "" : formatterOf(locale, format).format(value)

const charClass = (characters: string, flags?: string): RegExp =>
  new RegExp("[" + characters + "]", flags)

const hanNumerals = "零〇一二三四五六七八九"
const minusSigns = "-−－‒–—﹣"
const plusSigns = "+＋﹢"
const percentSigns = "%٪％﹪"
const permilleSigns = "‰؉"
const strayMarks = "，٬" + percentSigns + permilleSigns
const nonAsciiDigit = /[٠-٩۰-۹０-９]/
const anyNumeral = charClass("0-9٠-٩۰-۹０-９" + hanNumerals)
const arabicOrPersian = /[٠-٩۰-۹]/
const han = charClass(hanNumerals)
const anyDigit = charClass("\\p{Nd}" + hanNumerals, "gu")
const percent = charClass(percentSigns)
const permille = charClass(permilleSigns)
const strayDot = new RegExp(
  "\\.(?!" + charClass(strayMarks).source + "*\\d)",
  "g"
)
const strayMark = charClass(strayMarks, "g")
const baseSymbols = [".", ",", "．", "，", "٫", "٬"]
const spaceSeparator = /\p{Zs}/u
const groupingApostrophes = "'’"
const apostropheGroup = charClass(groupingApostrophes)
const apostropheGroups = charClass(groupingApostrophes, "g")
const formatControl = /\p{Cf}/u
const formatControls = /\p{Cf}/gu
const anyMinus = charClass(minusSigns)
const anyPlus = charClass(plusSigns)
const anySign = charClass(minusSigns + plusSigns)
const minuses = charClass(minusSigns, "gu")
const pluses = charClass(plusSigns, "gu")

const isNumeral = (character: string): boolean => anyNumeral.test(character)

// Some locales group from six digits and compact notation abbreviates seven,
// so both sizes are needed to see every separator.
const sampleNumbers = [1111111.1, 11111.1]

const pluralNumbers = [
  0,
  1,
  2,
  3,
  5,
  6,
  7,
  11,
  21,
  100,
  0.02,
  1.01,
  1.5,
  1.49,
  1e6
]

const partsCache = new Map<string, ReadonlyArray<Intl.NumberFormatPart>>()

const partsOf = (
  all: boolean,
  locale: Locale,
  format?: Format
): ReadonlyArray<Intl.NumberFormatPart> =>
  cached(partsCache, { all, locale, format }, () => {
    const formatter = formatterOf(locale, format)
    return (all ? [...sampleNumbers, ...pluralNumbers] : sampleNumbers).flatMap(
      (value) => formatter.formatToParts(value)
    )
  })

const decimalOf = (locale: Locale, numberingSystem?: string): string =>
  formatterOf(locale, { numberingSystem, useGrouping: false })
    .formatToParts(0.1)
    .find((part) => part.type === "decimal")?.value ?? "."

interface LocaleDetails {
  readonly decimal: string
  readonly group?: string | undefined
  readonly currency?: string | undefined
  readonly percentSign?: string | undefined
  readonly exponentSeparator?: string | undefined
}

const localeDetails = (locale: Locale, format?: Format): LocaleDetails => {
  const details: Record<string, string> = {}
  for (const part of partsOf(false, locale, format)) {
    details[part.type] = part.value
  }
  return { ...details, decimal: decimalOf(locale, format?.numberingSystem) }
}

const digitsOf = (locale: Locale, format?: Format): ReadonlyArray<string> =>
  Array.from(
    formatterOf(locale, {
      numberingSystem: format?.numberingSystem,
      useGrouping: false
    }).format(9876543210)
  ).reverse()

const toAscii = (value: string, digits: ReadonlyArray<string>): string =>
  value.replace(anyDigit, (character) => {
    const localeDigit = digits.indexOf(character)
    if (localeDigit !== -1) return String(localeDigit)
    const hanDigit = hanNumerals.indexOf(character)
    // Both zeros come first, so the digit is one less than the index.
    if (hanDigit !== -1) return String(Math.max(hanDigit - 1, 0))
    // The bases of these digit ranges are multiples of 16.
    return nonAsciiDigit.test(character)
      ? String(character.charCodeAt(0) % 16)
      : character
  })

interface Reader {
  readonly decimal: string
  readonly localeDecimal: string
  readonly group: string | undefined
  readonly exponent: string | undefined
  readonly digits: ReadonlyArray<string>
  readonly labels: ReadonlyArray<string>
}

const readers = new Map<string, Reader>()

const readerOf = (locale: Locale, format?: Format): Reader =>
  cached(readers, { locale, format }, () => {
    const { decimal, exponentSeparator, group } = localeDetails(locale, format)
    const digits = digitsOf(locale, format)
    return {
      decimal,
      localeDecimal: decimalOf(locale),
      group: group === "" ? undefined : group,
      exponent: exponentSeparator === undefined || exponentSeparator === ""
        ? undefined
        : toAscii(exponentSeparator, digits),
      digits,
      // The formatter's own labels go first, while they still match, so a dot
      // inside one isn't read as a separator.
      labels: partsOf(true, locale, format)
        .filter((part) => part.type === "currency" || part.type === "unit")
        .map((part) => part.value.replace(formatControls, ""))
        .sort((a, b) => b.length - a.length)
    }
  })

const shiftDecimal = (value: number, by: number): number => {
  const [coefficient, exponent = "0"] = String(value).split("e")
  return Number(coefficient + "e" + (Number(exponent) + by))
}

export const parseNumber = (
  text: string,
  locale: Locale,
  format?: Format
): number | null => {
  let input = text.replace(formatControls, "").trim()
  let from = locale
  if (from === undefined) {
    if (arabicOrPersian.test(input)) from = "ar"
    else if (han.test(input)) from = "zh"
  }
  const { decimal, digits, exponent, group, labels, localeDecimal } = readerOf(
    from,
    format
  )
  input = input.replace(minuses, "-").replace(pluses, "+")
  let negative = false
  const takeSign = (_match: string, sign: string): string => {
    if (sign !== "+") negative = true
    return ""
  }
  input = input.replace(/^\s*([+-])/, takeSign)
  for (const label of labels) input = input.replaceAll(label, "")
  input = toAscii(input, digits)
  if (exponent !== undefined) input = input.replaceAll(exponent, "e")
  input = input.replace(/(?<![\p{L}\p{M}])([+-])\s*$/u, takeSign)
  if (format?.currencySign === "accounting") {
    input = input.replace(/^\s*(\()/, takeSign)
  }
  if (group !== undefined) {
    input = input.replaceAll(
      spaceSeparator.test(group)
        ? /\p{Zs}/gu
        : apostropheGroup.test(group)
        ? apostropheGroups
        : group,
      ""
    )
  }
  input = input.replace(strayDot, "")
  const plain = input
    .replaceAll(decimal, ".")
    .replaceAll(localeDecimal, ".")
    .replace(/[．٫]/g, ".")
    .replace(strayMark, "")
    .trim()
    .replace(/\.(?=[^.]*\.)/g, "")
  if (/^[-+]?Infinity$/i.test(input) || input.includes("∞")) return null
  let parsed = parseFloat((negative ? "-" : "") + plain)
  if (permille.test(input)) parsed = shiftDecimal(parsed, -3)
  else if (
    !(format?.style === "unit" && format.unit === "percent") &&
    (percent.test(input) || format?.style === "percent")
  ) {
    parsed = shiftDecimal(parsed, -2)
  }
  return Number.isFinite(parsed) ? parsed : null
}

export interface Typing {
  readonly allowed: string
  readonly single: ReadonlyArray<string>
}

const typingCache = new Map<string, Typing>()

export const typingOf = (
  locale: Locale,
  format: Format | undefined,
  negative: boolean
): Typing =>
  cached(typingCache, { locale, format, negative }, () => {
    const parts = partsOf(true, locale, format)
    const details = localeDetails(locale, format)
    const allowed = new Set<string>(baseSymbols)
    const add = (characters: Iterable<string>) => {
      for (const character of characters) allowed.add(character)
    }
    allowed.add(
      parts.find((part) => part.type === "decimal")?.value ?? details.decimal
    )
    for (const part of parts) {
      if (
        ["integer", "fraction", "exponentInteger", "compact"].includes(
          part.type
        )
      ) continue
      add(Array.from(part.value))
      if (spaceSeparator.test(part.value)) allowed.add(" ")
    }
    if (details.group !== undefined && apostropheGroup.test(details.group)) {
      add(groupingApostrophes)
    }
    add(digitsOf(locale, format))
    const style = format?.style
    if (
      style === "percent" || (style === "unit" && format?.unit === "percent")
    ) add(percentSigns)
    if (
      style === "percent" || (style === "unit" && format?.unit === "permille")
    ) add(permilleSigns)
    add(plusSigns)
    if (negative) {
      add(minusSigns)
      if (format?.currencySign === "accounting") add(["(", ")"])
    }
    return {
      allowed: Array.from(allowed).join(""),
      single: [details.decimal, details.currency, details.percentSign].filter((
        symbol
      ) => symbol !== undefined)
    }
  })

const allowsCharacter = (
  character: string,
  typing: Pick<Typing, "allowed">
): boolean =>
  isNumeral(character) || anyMinus.test(character) ||
  typing.allowed.includes(character) ||
  formatControl.test(character)

export const allowsText = (
  text: string,
  typing: Pick<Typing, "allowed">
): boolean =>
  Array.from(text).every((character) => allowsCharacter(character, typing))

export const allowedIn = (
  text: string,
  typing: Pick<Typing, "allowed">
): string =>
  Array.from(text).filter((character) => allowsCharacter(character, typing))
    .join("")

const navigationKeys = new Set([
  "Backspace",
  "Delete",
  "ArrowLeft",
  "ArrowRight",
  "Tab",
  "Enter",
  "Escape"
])

export interface Keystroke {
  readonly key: string
  readonly text: string
  readonly start: number | null
  readonly end: number | null
  readonly modified: boolean
}

export const allowsKey = (
  { end, key, modified, start, text }: Keystroke,
  typing: Typing
): boolean => {
  if (modified || navigationKeys.has(key) || isNumeral(key)) return true
  const all = start === 0 && end === text.length
  const selects = (index: number): boolean =>
    start !== null && end !== null && index >= start && index < end
  let allowed = typing.allowed.includes(key)
  for (const detect of [anyMinus, anyPlus]) {
    if (detect.test(key) && detect.test(typing.allowed)) {
      const at = text.search(anySign)
      allowed = at === -1 || all || selects(at)
    }
  }
  for (const symbol of typing.single) {
    if (key === symbol) {
      const at = text.indexOf(symbol)
      allowed = at === -1 || all || selects(at)
    }
  }
  return allowed || key.length > 1
}

const hasRounding = (format?: Format): format is Format =>
  format?.maximumFractionDigits != null ||
  format?.minimumFractionDigits != null ||
  format?.maximumSignificantDigits != null ||
  format?.minimumSignificantDigits != null ||
  format?.roundingIncrement != null ||
  format?.roundingMode != null ||
  format?.roundingPriority != null

const withoutFloatNoise = (value: number): number => {
  if (!Number.isFinite(value)) return value
  const precise = parseFloat(value.toPrecision(15))
  // Capped, so large values keep their real fraction digits.
  return Math.abs(precise - value) <=
      Math.min(Number.EPSILON * Math.max(1, Math.abs(value)), 1e-10)
    ? precise
    : value
}

const roundedTo = (value: number, format: Format): number => {
  if (!Number.isFinite(value)) return value
  const formatter = formatterOf("en-US", {
    ...format,
    signDisplay: "auto",
    currencySign: "standard",
    notation: format.notation === "compact" ? "standard" : format.notation,
    useGrouping: false
  })
  const text = formatter.format(value)
  const parsed = parseNumber(text, "en-US", format)
  return parsed !== null && formatter.format(parsed) === text ? parsed : value
}

export const rounded = (value: number, format?: Format): number =>
  hasRounding(format) ? roundedTo(value, format) : value

const snapped = (
  value: number,
  base: number,
  step: number,
  nearest: boolean
): number => {
  const size = Math.abs(step)
  const direction = Math.sign(step)
  const steps = value - base + size * 1e-10 * direction
  if (nearest) return base + Math.round(steps / step) * step
  return base +
    (direction > 0 ? Math.floor(steps / size) : Math.ceil(steps / size)) * size
}

export interface Range {
  readonly min: number | undefined
  readonly max: number | undefined
  readonly format: Format | undefined
  readonly snapOnStep: boolean
}

export const lowest = (range: Range): number =>
  range.min ?? Number.MIN_SAFE_INTEGER
export const highest = (range: Range): number =>
  range.max ?? Number.MAX_SAFE_INTEGER

export const validated = (
  value: number,
  range: Range,
  options: {
    readonly step?: number | undefined
    readonly small?: boolean
    readonly clamp: boolean
  }
): number => {
  const { step } = options
  const min = lowest(range)
  const max = highest(range)
  let next = value
  if (step !== undefined && step !== 0 && range.snapOnStep) {
    next = snapped(next, range.min ?? 0, step, options.small === true)
  }
  // Clamped before rounding and again after it, as rounding can push a value
  // back out of a fractional bound.
  if (options.clamp) next = clamp(next, min, max)
  const rounds = hasRounding(range.format)
  if (step === undefined && !rounds) return next
  const clean = rounds
    ? roundedTo(next, range.format as Format)
    : withoutFloatNoise(next)
  return options.clamp ? clamp(clean, min, max) : clean
}
