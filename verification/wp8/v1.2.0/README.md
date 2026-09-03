# WP8 sparse-ranking metric successor v1.2.0

This versioned package evaluates the unchanged retrieval-v2 development
candidate with present-source normalized DCG@5. The metric uses each question's
attainable present-source gold as its ideal denominator, preserving physical
rank discounts and duplicate penalties while removing nonexistent sparse-gold
slots from the quality denominator.

The package preserves evaluator v2.0.0 and the WP8 v1.1.0 failure receipt. It
still reports the historical fixed-slot score and mathematical ceiling. The
zero-tolerance safety rules are unchanged; held-out data is not evaluated;
AUTH-13, release readiness, and production eligibility remain closed.
