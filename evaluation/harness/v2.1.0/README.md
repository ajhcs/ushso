# Retrieval evaluator metric successor v2.1.0

This additive successor preserves evaluator v2.0.0 and replaces only the
infeasible sparse-ranking quality gate. Present-source normalized DCG@5 scores
the returned ordering against the ideal ordering attainable from each
question's available present-source gold. It therefore measures ranking
quality without treating nonexistent gold items as failed rank slots.

The historical fixed-slot graded precision remains reported for continuity.
Safety remains zero-tolerance, AUTH-13 remains mandatory for the one-time
held-out run, and this package authorizes no production or external action.
