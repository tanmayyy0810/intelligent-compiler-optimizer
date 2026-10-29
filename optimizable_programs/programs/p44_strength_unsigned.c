/* 44. Unsigned divide and modulo
 * For unsigned values x/4 is x>>2 and x%8 is x&7 (not valid for signed, so the compiler leaves signed alone).
 */
unsigned int ushift(unsigned int x) {
    return x / 4 + x % 8;
}
