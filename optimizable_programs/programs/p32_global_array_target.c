/* 32. Global array as the output
 * A restrict parameter cannot alias the global array; trip count 64 is a multiple of 4.
 */
int out[64];
void fill_from(int * restrict src) {
    for (int i = 0; i < 64; i++) out[i] = src[i] + 1;
}
