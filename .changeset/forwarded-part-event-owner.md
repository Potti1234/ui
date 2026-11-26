---
"@effect/ui": patch
"@effect/ui-kit": patch
---

Keep event handlers added by a headless part's `.forward()` callback on that part, so they send messages to its component without replacing the consumer's handlers.

Keep disabled Toolbar buttons inert when the consumer provides its own click handler.
