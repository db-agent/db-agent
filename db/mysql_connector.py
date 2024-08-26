import pymysql
from pymysql import MySQLError

class MySQLConnector():
    def __init__(self, config):
        self.config = config
        self.connection = None
        self.cursor = None

    def connect(self):
        try:
            self.connection = pymysql.connect(**self.config)
            self.cursor = self.connection.cursor(pymysql.cursors.DictCursor)
        except MySQLError as e:
            print(f"Error connecting to MySQL database: {e}")

    def query(self, query, params=None):
        if self.connection is None or self.cursor is None:
            self.connect()
        try:
            self.cursor.execute(query, params or ())
            if query.lower().startswith("select"):
                return self.cursor.fetchall()
            else:
                self.connection.commit()
        except MySQLError as e:
            print(f"Error executing MySQL query: {e}")

    def close(self):
        if self.cursor:
            self.cursor.close()
        if self.connection:
            self.connection.close()
        self.cursor = None
        self.connection = None
