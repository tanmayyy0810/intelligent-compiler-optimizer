/* 16. Buffer printed but not leaked
 * Passing a pointer to printf does not make it escape, so the buffer is still promoted.
 */
int main() {
    int *t = (int *) malloc(4 * sizeof(int));
    for (int i = 0; i < 4; i++) t[i] = (i + 1) * 11;
    printf("%d %d %d %d\n", t[0], t[1], t[2], t[3]);
    free(t);
    return 0;
}
