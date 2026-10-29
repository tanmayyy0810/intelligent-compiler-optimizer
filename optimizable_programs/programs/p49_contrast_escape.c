/* 49. Contrast: malloc that escapes
 * The pointer is returned, so the block must stay on the heap (RETURN_ESCAPE).
 */
int *make() {
    int *p = (int *) malloc(4 * sizeof(int));
    p[0] = 10 * 2;
    return p;
}
