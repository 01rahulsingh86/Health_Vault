# Discount rules feature

Orders allow discounts between **0 and 50 percent inclusive**. Any discount above 50 must fail with HTTP 400. This is the acceptance criterion for this PR. Existing tests do not cover the upper boundary.
