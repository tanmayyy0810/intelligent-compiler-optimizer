/* 40. Repeated array read
 * p[2] is read three times with no store in between, so it is loaded once.
 */
int loads(int *p) {
    return p[2] * p[2] + p[2];
}
