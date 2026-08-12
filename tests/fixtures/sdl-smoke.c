#include <SDL.h>
#include <stdint.h>
#include <stdlib.h>

static SDL_Window *window;
static SDL_Surface *surface;
static int keyed;

static uint32_t rgba(int r, int g, int b) {
    return (uint32_t)r | ((uint32_t)g << 8) | ((uint32_t)b << 16) | 0xff000000u;
}

static void frame(void) {
    SDL_Event event;
    while (SDL_PollEvent(&event)) {
        if (event.type == SDL_EVENT_KEY_DOWN) keyed = 1;
        if (event.type == SDL_EVENT_QUIT) exit(0);
    }
    uint32_t color = keyed ? rgba(230, 40, 40) : rgba(30, 60, 180);
    uint32_t *pixels = (uint32_t *)surface->pixels;
    for (int i = 0; i < surface->w * surface->h; i++) pixels[i] = color;
    SDL_UpdateWindowSurface(window);
}

int main(void) {
    if (!SDL_Init(SDL_INIT_VIDEO)) return 2;
    window = SDL_CreateWindow("os-react-sdl-smoke", 320, 200, SDL_WINDOW_RESIZABLE);
    if (!window) return 3;
    surface = SDL_GetWindowSurface(window);
    if (!surface) return 4;
    __setAnimationFrameFunc(frame);
    return 0;
}
