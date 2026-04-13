/**
 * 加载动画组件
 */

import React, { useState, useEffect } from "react"
import { Text } from "ink"

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

interface SpinnerProps {
	label?: string
}

export function Spinner({ label }: SpinnerProps) {
	const [frame, setFrame] = useState(0)

	useEffect(() => {
		const timer = setInterval(() => {
			setFrame((prev) => (prev + 1) % FRAMES.length)
		}, 80)
		return () => clearInterval(timer)
	}, [])

	return (
		<Text dimColor>
			{FRAMES[frame]} {label ?? "Thinking..."}
		</Text>
	)
}
