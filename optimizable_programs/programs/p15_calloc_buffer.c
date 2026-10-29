/* 15. calloc scratch buffer
 * A zero-initialised temporary buffer that does not escape is promoted to the stack.
 */
int main() {
    int *buf = (int *) calloc(8, sizeof(int));
    for (int i = 0; i < 8; i++) buf[i] = buf[i] + i * 2;
    int s = 0;
    for (int i = 0; i < 8; i++) s += buf[i];
    free(buf);
    return s;
}
