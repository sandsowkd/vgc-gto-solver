//! Cooperative cancellation and truthful counters shared with the HTTP job API.
use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
#[derive(Default)]
pub struct Control {
    pub cancelled: AtomicBool,
    pub phase: AtomicUsize,
    pub total: AtomicU64,
    pub covered: AtomicU64,
    pub samples: AtomicU64,
    pub iterations: AtomicU64,
    pub gap_bits: AtomicU64,
}
#[derive(Serialize)]
pub struct Progress {
    pub phase: &'static str,
    pub pairs: u64,
    pub covered: u64,
    pub samples: u64,
    pub iterations: u64,
    pub nash_gap: Option<f64>,
}
impl Control {
    pub fn check(&self) -> crate::Result<()> {
        if self.cancelled.load(Ordering::Relaxed) {
            Err("Solve cancelled".into())
        } else {
            Ok(())
        }
    }
    pub fn snapshot(&self) -> Progress {
        let iterations = self.iterations.load(Ordering::Relaxed);
        Progress {
            phase: match self.phase.load(Ordering::Relaxed) {
                0 => "initializing",
                1 => "sampling",
                2 => "solving",
                _ => "complete",
            },
            pairs: self.total.load(Ordering::Relaxed),
            covered: self.covered.load(Ordering::Relaxed),
            samples: self.samples.load(Ordering::Relaxed),
            iterations,
            nash_gap: (iterations > 0)
                .then(|| f64::from_bits(self.gap_bits.load(Ordering::Relaxed))),
        }
    }
}
