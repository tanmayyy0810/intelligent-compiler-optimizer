/* 31. Unary and bitwise operators
 * Vector forms exist for unary minus and bitwise AND.
 */
void neg_mask(int * restrict out, int * restrict in, int n) {
    for (int i = 0; i < n; i++) out[i] = (-in[i]) & 255;
}
