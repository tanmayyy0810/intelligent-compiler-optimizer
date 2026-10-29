/* 07. Bit masks
 * Shifts and bitwise operators on constants (unsigned) are evaluated at compile time.
 */
unsigned int make_mask() {
    unsigned int hi = 0xFF << 8;
    unsigned int lo = 0x0F;
    return (hi | lo) ^ 0x1;
}
