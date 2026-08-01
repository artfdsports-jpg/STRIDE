# The platform-agnostic core, and its tests.
#
# This builds and runs anywhere with a C++17 compiler. It deliberately does not
# reference the Illustrator SDK: the plugin target in native/src does that, and
# keeping the geometry out of it is what lets the maths be tested on any machine
# and what confines each autumn's SDK break to the bridge layer.

cmake_minimum_required(VERSION 3.16)
project(chisel_core LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

add_library(chisel_core STATIC
    ChiselGeom.cpp
    ChiselHit.cpp
)
target_include_directories(chisel_core PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})

if(MSVC)
    target_compile_options(chisel_core PRIVATE /W4)
else()
    target_compile_options(chisel_core PRIVATE -Wall -Wextra -Wpedantic)
endif()

enable_testing()
add_executable(chisel_core_tests test/CoreTests.cpp)
target_link_libraries(chisel_core_tests PRIVATE chisel_core)
add_test(NAME core COMMAND chisel_core_tests)
