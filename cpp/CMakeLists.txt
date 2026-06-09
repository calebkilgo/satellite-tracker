cmake_minimum_required(VERSION 3.15)
project(sgp4_wasm CXX)

set(CMAKE_CXX_STANDARD 17)

add_executable(sgp4
    sgp4.cpp
    bindings.cpp
)

target_include_directories(sgp4 PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})

# Emscripten link flags
set_target_properties(sgp4 PROPERTIES
    SUFFIX ".js"
)

target_link_options(sgp4 PRIVATE
    -lembind
    "SHELL:-s MODULARIZE=1"
    "SHELL:-s EXPORT_ES6=1"
    "SHELL:-s EXPORT_NAME=createSGP4Module"
    "SHELL:-s ALLOW_MEMORY_GROWTH=1"
    "SHELL:-s ENVIRONMENT=web,worker"
    "SHELL:-s SINGLE_FILE=0"
    "SHELL:-O3"
    "SHELL:--closure 0"
)
