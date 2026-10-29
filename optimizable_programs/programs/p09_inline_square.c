/* 09. Inline small function
 * sq() is tiny and straight-line, so the call is replaced by its body; folding then finishes the job.
 */
int sq(int x) { return x * x; }
int main() {
    return sq(3) + sq(4);
}
