# <Feature name>

Copy this file to `docs/specs/<slug>.md` and fill it in **before** writing code. It is what the diff
gets reviewed against — a spec written afterwards is just the diff describing itself.

Keep it short. Four headings, no ceremony.

## Outcome

What can a user do after this ships that they could not before? One or two sentences, from the
user's side of the screen — not a description of the implementation.

## Surfaces touched

- [ ] iOS
- [ ] Android
- [ ] web

Answer this before building. The app targets all three, and web is the one that gets forgotten.

## Acceptance criteria

The conditions that make this done. Each one observable — something you could hand to another person
and have them check without reading the code.

- [ ]
- [ ]

## Out of scope

What this deliberately does not do. This is the half that stops scope creep during review: anything
in the diff that is not covered by the acceptance criteria and not excluded here is a question.
