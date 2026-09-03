# External authorization register successor v1.1.0

This successor preserves the digest-pinned denied-by-default v1.0.0 register
and applies one exact delta: AUTH-10 permits pushing the reviewed integration
branch and opening or updating a draft pull request before the deadline.

Every other authorization remains false. AUTH-10 does not permit merge,
production or managed-infrastructure actions, held-out evaluation, live
connector traffic, or repository exposure to external co-engineers.
