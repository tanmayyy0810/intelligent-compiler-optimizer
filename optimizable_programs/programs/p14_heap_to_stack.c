/* 14. malloc that never escapes
 * The block is only used inside the function, so it moves to the stack and free() is removed.
 */
int main() {
    int *p = (int *) malloc(10 * sizeof(int));
    for (int i = 0; i < 10; i++) p[i] = i * i;
    int r = p[3] + p[4];
    free(p);
    return r;
}
