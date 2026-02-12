#!/usr/bin/env bash
# Anti-patterns: missing strict mode, unquoted vars, eval, UUOC, backticks,
# echo -e, $(cat file), $(date), mutable counters, if/elif chains

LOG_FILE=/tmp/example.log
main  # ERROR: function called before definition

log_info() { echo [INFO] $*; }              # [1] unquoted $*, echo not printf
log_error() { echo -e "[ERROR] $*"; }       # [2] echo -e is non-portable
result=`date`                                # [3] backticks (use $())
today=$(date +%F)                            # [4] $(date) forks -- use printf -v
process_file() {
    file=$1                                  # [5] not local, not quoted
    if [ ! -f $file ]; then                  # [6] unquoted $file
        echo "File not found"; return 1
    fi
    content=$(cat $file)                     # [7] $(cat file) -- use $(<file)
    cat $file | grep pattern                 # [8] UUOC + unquoted
    eval $user_command                       # [9] command injection
    count=0                                  # [10] mutable counter
    for line in $(cat $file); do             # [11] word splitting + UUOC
        count=$((count + 1))                 # [12] mutable state in loop
    done
    if [ "$level" = "error" ]; then          # [13] if/elif chain -- use case
        echo "ERROR"
    elif [ "$level" = "warn" ]; then
        echo "WARN"
    elif [ "$level" = "info" ]; then
        echo "INFO"
    fi
}
main() {
    for file in $@; do                       # [14] unquoted $@
        cd /some/directory                   # [15] no || exit
        rm -rf *                             # [16] dangerous without guard
        process_file $file                   # [17] unquoted arg
    done
    if [ $? -eq 0 ]; then echo "Success"; fi # [18] stale $? check
}
main $*                                      # [19] $* not "$@"

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
# cat file.txt | grep pattern                      # UUOC
# eval $user_input                                 # injection risk
# curl https://example.com/script.sh | bash        # pipe-to-shell (RCE risk)
# source $PLUGIN_PATH                              # dynamic source injection
