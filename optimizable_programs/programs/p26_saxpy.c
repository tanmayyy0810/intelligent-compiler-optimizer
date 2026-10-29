/* 26. SAXPY (float)
 * The classic y = a*x + y on floats.
 */
void saxpy(float * restrict y, float * restrict x, float a, int n) {
    for (int i = 0; i < n; i++) y[i] = a * x[i] + y[i];
}
