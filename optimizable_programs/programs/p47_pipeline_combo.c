/* 47. Inline + CSE + LICM + vectorize together
 * A helper is inlined, its invariant part hoisted, and the loop vectorized.
 */
int weight(int k) { return k * 4 + 1; }
void apply(int * restrict out, int * restrict in, int k, int n) {
    for (int i = 0; i < n; i++)
        out[i] = in[i] * weight(k);
}
