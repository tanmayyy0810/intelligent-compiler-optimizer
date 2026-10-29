/* 39. Repeated expression
 * (a + b) is computed twice; the second computation reuses the first.
 */
int common(int a, int b) {
    int x = (a + b) * 2;
    int y = (a + b) * 3;
    return x + y;
}
