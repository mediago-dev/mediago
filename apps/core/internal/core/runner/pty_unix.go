//go:build !windows
// +build !windows

package runner

import (
	"context"
	"os"
	"os/exec"
	"syscall"
	"time"

	mediagocore "caorushizi.cn/mediago/internal/core"
	"github.com/creack/pty"
)

// runWithPTY uses creack/pty on Unix platforms (Linux/Mac)
func (r *PTYRunner) runWithPTY(ctx context.Context, binPath string, args []string, onStdLine func(string), options mediagocore.RunnerOptions) error {
	// create the command
	if err := ctx.Err(); err != nil {
		return err
	}
	cmd := exec.Command(binPath, args...)
	if options.Environment != nil {
		cmd.Env = options.Environment
	}

	// start the PTY
	ptmx, err := pty.Start(cmd)
	if err != nil {
		// PTY failed, fall back to regular pipe
		return r.fallbackToPipe(ctx, binPath, args, onStdLine, options)
	}
	defer ptmx.Close()

	// set PTY window size
	_ = pty.Setsize(ptmx, &pty.Winsize{
		Rows: 24,
		Cols: 80,
	})

	// read output
	done := make(chan error, 1)
	go func() {
		done <- r.readPTYOutput(ptmx, onStdLine)
	}()

	// wait for the process to complete
	cmdDone := make(chan error, 1)
	go func() {
		cmdDone <- cmd.Wait()
	}()

	select {
	case <-ctx.Done():
		if gracefulStopRequested(options) {
			if err := syscall.Kill(-cmd.Process.Pid, syscall.SIGINT); err != nil {
				_ = cmd.Process.Signal(os.Interrupt)
			}
			timer := time.NewTimer(gracefulStopPeriod(options))
			select {
			case <-cmdDone:
				timer.Stop()
			case <-timer.C:
				_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
				_ = cmd.Process.Kill()
				<-cmdDone
			}
		} else {
			_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
			_ = cmd.Process.Kill()
			<-cmdDone
		}
		_ = ptmx.Close()
		<-done
		return ctx.Err()
	case err := <-cmdDone:
		_ = ptmx.Close()
		<-done
		return err
	}
}
