"""Cooperative cancellation and bounded native work for one analysis pair."""
from contextlib import contextmanager
from contextvars import ContextVar
from threading import Event, Timer

import manifold3d

PAIR_SECONDS = 90
FIT_SECONDS = 45
current_control = ContextVar('analysis_control', default=None)


class AnalysisCancelled(Exception):
    pass


class AnalysisLimit(Exception):
    pass


class AnalysisControl:
    def __init__(self, on_stage=lambda stage: None):
        self.on_stage = on_stage
        self.cancelled = Event()
        self.expired = Event()
        self.native = None

    def cancel(self):
        self.cancelled.set()
        native = self.native
        if native is not None:
            native.cancel()

    def expire(self):
        self.expired.set()
        native = self.native
        if native is not None:
            native.cancel()

    def check(self):
        self.check_cancelled()
        if self.expired.is_set():
            raise AnalysisLimit()

    def check_cancelled(self):
        if self.cancelled.is_set():
            raise AnalysisCancelled()

    def stage(self, name):
        self.check()
        self.on_stage(name)

    @contextmanager
    def pair(self):
        self.expired.clear()
        self.native = manifold3d.ExecutionContext()
        token = current_control.set(self)
        timer = Timer(PAIR_SECONDS, self.expire)
        timer.daemon = True
        timer.start()
        try:
            self.check()
            yield
        finally:
            timer.cancel()
            timer.join()
            current_control.reset(token)
            self.native = None

    @contextmanager
    def fit(self):
        timer = Timer(FIT_SECONDS, self.expire)
        timer.daemon = True
        timer.start()
        try:
            yield
        finally:
            timer.cancel()
            timer.join()


def stage(name):
    control = current_control.get()
    if control is not None:
        control.stage(name)


def evaluated(solid):
    control = current_control.get()
    if control is not None:
        control.check()
        solid = solid.with_context(control.native)
    status = solid.status()
    if control is not None:
        control.check()
    if status != manifold3d.Error.NoError:
        raise ValueError('Silnik nie zwrócił poprawnego wyniku przecięcia.')
    return solid
