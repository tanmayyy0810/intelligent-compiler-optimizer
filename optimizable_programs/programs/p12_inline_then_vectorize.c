/* 12. Inline, then vectorize
 * Inlining scale() removes the call, which makes the loop vectorizable.
 */
int scale(int x) { return x * 3 + 1; }
void apply(int * restrict out, int * restrict in, int n) {
    for (int i = 0; i < n; i++) {
        out[i] = scale(in[i]);
    }
}
