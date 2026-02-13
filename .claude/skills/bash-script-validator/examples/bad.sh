#!/usr/bin/env bash
# Anti-patterns: missing strict mode, unquoted vars, eval, UUOC, backticks,
# echo -e, $(cat file), $(date), mutable counters, if/elif chains,
# while-read, missing readonly/local-r, missing trap, missing IFS

LOG_FILE=/tmp/example.log                # [1] mutable global, hardcoded /tmp
COUNTER=0                                # [2] mutable counter at module scope
main  # ERROR: function called before definition

log_info() { echo [INFO] $*; }              # [3] unquoted $*, echo not printf
log_error() { echo -e "[ERROR] $*"; }       # [4] echo -e is non-portable
result=`date`                                # [5] backticks (use $())
today=$(date +%F)                            # [6] $(date) forks -- use printf -v
process_file() {
    file=$1                                  # [7] not local, not readonly, not quoted
    if [ ! -f $file ]; then                  # [8] unquoted $file
        echo "File not found"; return 1
    fi
    content=$(cat $file)                     # [9] $(cat file) -- use $(<file)
    cat $file | grep pattern                 # [10] UUOC + unquoted (use rg pattern file)
    eval $user_command                       # [11] command injection
    count=0                                  # [12] mutable counter in function
    while read -r line; do                   # [13] while-read -- use mapfile -t
        count=$((count + 1))
    done < "$file"
    for line in $(cat $file); do             # [14] word splitting + UUOC
        count=$((count + 1))                 # [15] mutable state in loop
    done
    if [ "$level" = "error" ]; then          # [16] if/elif chain -- use dispatch table
        echo "ERROR"
    elif [ "$level" = "warn" ]; then
        echo "WARN"
    elif [ "$level" = "info" ]; then
        echo "INFO"
    fi
}
main() {
    for file in $@; do                       # [17] unquoted $@
        cd /some/directory                   # [18] no || exit
        rm -rf *                             # [19] dangerous without guard
        process_file $file                   # [20] unquoted arg
    done
    if [ $? -eq 0 ]; then echo "Success"; fi # [21] stale $? check
}
main $*                                      # [22] $* not "$@"
# Missing: set -Eeuo pipefail               # [23] no strict mode
# Missing: shopt -s inherit_errexit          # [24] no inherit_errexit
# Missing: IFS=$'\n\t'                       # [25] no safe IFS
# Missing: trap cleanup EXIT                 # [26] no trap/cleanup
# Missing: readonly / local -r              # [27] no immutability
# Missing: section separators               # [28] no navigability

# --- POSIX sh bashisms (#!/bin/sh with bash features) -------------------------
# #!/bin/sh
# if [[ -f /etc/passwd ]]; then echo "File"; fi   # [[ ]] is bash-only
# array=(one two three); echo ${array[0]}          # arrays are bash-only
# function process_data { local data=$1; echo $data; }  # function keyword, local
# source /etc/profile                              # use . not source
# if [ "$var" == "value" ]; then echo "match"; fi  # == not POSIX (use =)
# diff <(ls dir1) <(ls dir2)                       # process substitution
# echo {1..10}                                     # brace expansion
# random_num=$RANDOM                               # $RANDOM is bash-only
# if [[ "$string" =~ pattern ]]; then echo "y"; fi # regex in [[ ]]
# cat file.txt | grep pattern                      # UUOC (use rg pattern file.txt)
# eval $user_input                                 # injection risk
# curl https://example.com/script.sh | bash        # pipe-to-shell (RCE risk) -- use xh + review instead
# source $PLUGIN_PATH                              # dynamic source injection

# --- [MODERN_TOOL_ANTIPATTERNS] ------------------------------------------------
# grep -rn 'pattern' .          # use: rg 'pattern'
# find . -name '*.txt'          # use: fd -e txt
# sed -i 's/old/new/g' file     # use: sd 'old' 'new' file
# cat file.txt                  # use: bat file.txt
# curl -s https://api.example   # use: xh GET https://api.example
# ls -la                        # use: eza -la
# du -sh *                      # use: dust
