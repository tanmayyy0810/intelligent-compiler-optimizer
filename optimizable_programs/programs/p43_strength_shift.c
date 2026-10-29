/* 43. Multiply by powers of two
 * x*8 and x*16 become shifts (x<<3, x<<4).
 */
int shifts(int x) {
    return x * 8 + x * 16;
}
